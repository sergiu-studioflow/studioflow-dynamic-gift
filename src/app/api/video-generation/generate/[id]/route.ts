import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { pollVideoJob } from "@/lib/video-generation/video-provider";
import { uploadToR2, r2Key, toAccessibleUrl, r2KeyFromUrl } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export const dynamic = "force-dynamic";

/** Resolve the R2 storage prefix for a generation's client */
async function getPrefix(clientId: string | null): Promise<string> {
  if (!clientId) return "web-profits";
  const prefix = await getClientStoragePrefix(clientId);
  return prefix || "web-profits";
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
        const key = r2Key(prefix, "video-generation/outputs", `${generation.id}.${ext}`);
        const r2Url = await uploadToR2(key, buffer, contentType);

        await db
          .update(schema.videoGenerations)
          .set({ videoUrl: r2Url, updatedAt: new Date() })
          .where(eq(schema.videoGenerations.id, id));

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

  // Still processing — poll Muapi
  if (generation.status === "processing" && generation.muapiRequestId) {
    try {
      const result = await pollVideoJob(generation.muapiRequestId);

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
            const key = r2Key(prefix, "video-generation/outputs", `${generation.id}.${ext}`);
            finalVideoUrl = await uploadToR2(key, buffer, contentType);
          }
        } catch {
          // Keep Muapi URL if R2 upload fails
        }

        await db
          .update(schema.videoGenerations)
          .set({ videoUrl: finalVideoUrl, status: "completed", updatedAt: new Date() })
          .where(eq(schema.videoGenerations.id, id));

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
          .where(eq(schema.videoGenerations.id, id));

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
          .where(eq(schema.videoGenerations.id, id));

        return NextResponse.json({
          ...generation,
          status: "error",
          errorMessage: "Video generation completed but no video was produced",
        });
      }

      // Still processing
      return NextResponse.json({
        ...generation,
        muapiStatus: result.status,
      });
    } catch {
      // Transient poll error — return current state
      return NextResponse.json(generation);
    }
  }

  // Pending or other states
  return NextResponse.json(generation);
}
