import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { and, eq, notInArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { pollVideoJob } from "@/lib/video-generation/video-provider";
import { uploadToR2, toAccessibleUrl, r2KeyFromUrl, deleteFromR2, ownedR2Key } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { enqueueGateReview } from "@/lib/qc/enqueue";
import {
  failVideoGeneration,
  isPipelineAbandoned,
  isProcessingAbandoned,
  PIPELINE_ABANDONED_MESSAGE,
  processingAbandonedMessage,
  sameAttempt,
} from "@/lib/video-generation/abandon";

export const dynamic = "force-dynamic";

/** Resolve the R2 storage prefix for a generation's client */
async function getPrefix(clientId: string | null): Promise<string> {
  if (!clientId) return `brands/${process.env.BRAND_SLUG || "dynamic-gift"}`;
  const prefix = await getClientStoragePrefix(clientId);
  return prefix || `brands/${process.env.BRAND_SLUG || "dynamic-gift"}`;
}

/**
 * GET /api/video-generation/generate/[id]
 *
 * Poll for video generation status. When Muapi completes,
 * downloads the video and persists it to R2.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;

  const [generation] = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id));

  if (!generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  // Already completed — return with presigned video URL
  if (generation.status === "completed" && generation.videoUrl) {
    const isR2 = !!r2KeyFromUrl(generation.videoUrl);
    if (isR2) {
      const videoPreviewUrl = await toAccessibleUrl(generation.videoUrl);
      return NextResponse.json({ ...generation, videoPreviewUrl });
    }

    // Video URL is a temporary Muapi URL — download and persist to R2
    try {
      const videoRes = await fetch(generation.videoUrl);
      if (videoRes.ok) {
        const buffer = Buffer.from(await videoRes.arrayBuffer());
        const contentType = videoRes.headers.get("content-type") || "video/mp4";
        const ext = contentType.includes("webm") ? "webm" : "mp4";
        const prefix = await getPrefix(generation.clientId);
        const key = `${prefix}/video-generation/outputs/${generation.id}.${ext}`;
        const r2Url = await uploadToR2(key, buffer, contentType);

        await db
          .update(schema.videoGenerations)
          .set({ videoUrl: r2Url, updatedAt: new Date() })
          .where(eq(schema.videoGenerations.id, id));

        // Now durable — enqueue the Quality Control grade (the eager path skipped it
        // while the clip was still on a provider tempfile URL).
        await enqueueGateReview({
          sourceSystem: "video",
          sourceId: generation.id,
          clientId: generation.clientId,
          assetPath: r2Url,
          copyText: generation.script,
        });

        const videoPreviewUrl = await toAccessibleUrl(r2Url);
        return NextResponse.json({ ...generation, videoUrl: r2Url, videoPreviewUrl });
      }
    } catch {
      // Return with temp URL if R2 upload fails
    }

    return NextResponse.json(generation);
  }

  // Error state — return as-is
  if (generation.status === "error") {
    return NextResponse.json(generation);
  }

  // The inline prompt pipeline died (function timeout) before it could mark the row.
  if (isPipelineAbandoned(generation)) {
    return NextResponse.json(await failVideoGeneration(generation, PIPELINE_ABANDONED_MESSAGE));
  }

  // Still processing — poll Muapi
  if (generation.status === "processing" && generation.muapiRequestId) {
    try {
      const result = await pollVideoJob(generation.muapiRequestId, generation.duration, generation.videoModel);

      if (result.status === "completed" && result.videoUrl && result.videoUrl.length > 0) {
        // Download and persist to R2
        let finalVideoUrl = result.videoUrl;
        try {
          const videoRes = await fetch(result.videoUrl);
          if (videoRes.ok) {
            const buffer = Buffer.from(await videoRes.arrayBuffer());
            const contentType = videoRes.headers.get("content-type") || "video/mp4";
            const ext = contentType.includes("webm") ? "webm" : "mp4";
            const prefix = await getPrefix(generation.clientId);
            const key = `${prefix}/video-generation/outputs/${generation.id}.${ext}`;
            finalVideoUrl = await uploadToR2(key, buffer, contentType);
          }
        } catch {
          // Keep Muapi URL if R2 upload fails
        }

        await db
          .update(schema.videoGenerations)
          .set({ videoUrl: finalVideoUrl, status: "completed", updatedAt: new Date() })
          .where(sameAttempt(generation));

        // Quality Control gate. No-ops if the R2 upload fell back to a tempfile URL;
        // the lazy-persist branch above re-enqueues once R2 lands.
        await enqueueGateReview({
          sourceSystem: "video",
          sourceId: generation.id,
          clientId: generation.clientId,
          assetPath: finalVideoUrl,
          copyText: generation.script,
        });

        const videoPreviewUrl = r2KeyFromUrl(finalVideoUrl)
          ? await toAccessibleUrl(finalVideoUrl)
          : finalVideoUrl;

        return NextResponse.json({
          ...generation,
          videoUrl: finalVideoUrl,
          videoPreviewUrl,
          status: "completed",
        });
      }

      if (result.status === "failed") {
        await db
          .update(schema.videoGenerations)
          .set({ status: "error", errorMessage: result.error || "Video generation failed", updatedAt: new Date() })
          .where(sameAttempt(generation));

        return NextResponse.json({
          ...generation,
          status: "error",
          errorMessage: result.error || "Video generation failed",
        });
      }

      // Completed but no video URL — treat as error
      if (result.status === "completed" && !result.videoUrl) {
        await db
          .update(schema.videoGenerations)
          .set({ status: "error", errorMessage: "Video generation completed but no video was produced", updatedAt: new Date() })
          .where(sameAttempt(generation));

        return NextResponse.json({
          ...generation,
          status: "error",
          errorMessage: "Video generation completed but no video was produced",
        });
      }

      if (isProcessingAbandoned(generation)) {
        return NextResponse.json(await failVideoGeneration(generation, processingAbandonedMessage(generation)));
      }

      // Still processing
      return NextResponse.json({
        ...generation,
        muapiStatus: result.status,
      });
    } catch {
      // Transient poll error — return current state, unless the provider has been failing
      // to answer for longer than any render takes.
      if (isProcessingAbandoned(generation)) {
        return NextResponse.json(await failVideoGeneration(generation, processingAbandonedMessage(generation)));
      }
      return NextResponse.json(generation);
    }
  }

  // A render retry that died between claiming the row and submitting it.
  if (isProcessingAbandoned(generation)) {
    return NextResponse.json(await failVideoGeneration(generation, processingAbandonedMessage(generation)));
  }

  // Pending or other states
  return NextResponse.json(generation);
}

/** Posts in these states no longer need their media file. */
const POST_DONE_STATUSES = ["cancelled", "published", "failed"];

/**
 * DELETE /api/video-generation/generate/[id] — remove a video: its file (only from its own
 * brand folder — the bucket is shared by every StudioFlow brand), its Quality Control review,
 * and the row. Mirrors the static-ad delete. Refused while the video is still being made
 * (a finishing render would write it back) or while a live post publishes from its file.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete videos" }, { status: 403 });
  }

  const { id } = await params;
  const [generation] = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id))
    .limit(1);
  if (!generation) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  if (generation.status === "pending" || generation.status === "processing") {
    return NextResponse.json({ error: "This video is still being made — delete it once it finishes" }, { status: 409 });
  }

  if (generation.videoUrl) {
    const [livePost] = await db
      .select({ status: schema.scheduledPosts.status })
      .from(schema.scheduledPosts)
      .where(
        and(
          eq(schema.scheduledPosts.mediaUrl, generation.videoUrl),
          notInArray(schema.scheduledPosts.status, POST_DONE_STATUSES)
        )
      )
      .limit(1);
    if (livePost) {
      return NextResponse.json(
        { error: `This video is in the posting queue (post status: ${livePost.status}). Cancel or remove that post first.` },
        { status: 409 }
      );
    }
  }

  const key = generation.clientId
    ? ownedR2Key(generation.videoUrl, await getClientStoragePrefix(generation.clientId))
    : null;
  if (key) {
    try {
      await deleteFromR2(key);
    } catch (err) {
      console.error("[video-generation/delete] R2 cleanup failed:", err);
    }
  }

  // gate_reviews has no FK to its source: drop the review first, or QC keeps trying to grade
  // a video that no longer exists.
  await db
    .delete(schema.gateReviews)
    .where(and(eq(schema.gateReviews.sourceSystem, "video"), eq(schema.gateReviews.sourceId, id)));
  await db.delete(schema.videoGenerations).where(eq(schema.videoGenerations.id, id));

  return NextResponse.json({ success: true, fileDeleted: !!key });
}
