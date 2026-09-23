import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { pollVideoJob } from "@/lib/video-generation/video-provider";
import { uploadToR2 } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { enqueueGateReview } from "@/lib/qc/enqueue";
import {
  failAbandonedPipelines,
  failVideoGeneration,
  isProcessingAbandoned,
  processingAbandonedMessage,
  sameAttempt,
} from "@/lib/video-generation/abandon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/video-generation/sweep[?clientId=]
 *
 * Checks "processing" generations against the video provider and updates
 * any that have completed or failed. This catches generations that
 * finished while the user wasn't polling (navigated away, closed tab,
 * long generation times). Also fails rows whose pipeline or provider job was
 * abandoned (see lib/video-generation/abandon.ts). `clientId` scopes the sweep
 * to one brand so a gallery load doesn't poll every brand's jobs.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const clientId = request.nextUrl.searchParams.get("clientId");

  const abandoned = await failAbandonedPipelines(clientId);

  const processing = await db
    .select()
    .from(schema.videoGenerations)
    .where(
      clientId
        ? and(eq(schema.videoGenerations.status, "processing"), eq(schema.videoGenerations.clientId, clientId))
        : eq(schema.videoGenerations.status, "processing")
    );

  let completed = 0;
  let failed = 0;
  let stillProcessing = 0;

  for (const gen of processing) {
    if (!gen.muapiRequestId) {
      // A render retry that died between claiming the row and submitting it.
      if (isProcessingAbandoned(gen)) {
        await failVideoGeneration(gen, processingAbandonedMessage(gen));
        failed++;
      }
      continue;
    }

    try {
      const result = await pollVideoJob(gen.muapiRequestId, gen.duration);

      if (result.status === "completed" && result.videoUrl && result.videoUrl.length > 0) {
        // Download and persist to R2
        let finalVideoUrl = result.videoUrl;
        try {
          const videoRes = await fetch(result.videoUrl);
          if (videoRes.ok) {
            const buffer = Buffer.from(await videoRes.arrayBuffer());
            const contentType = videoRes.headers.get("content-type") || "video/mp4";
            const ext = contentType.includes("webm") ? "webm" : "mp4";
            const clientPrefix = gen.clientId ? await getClientStoragePrefix(gen.clientId) : null;
            const prefix = clientPrefix || `brands/${process.env.BRAND_SLUG || "dynamic-gift"}`;
            const key = `${prefix}/video-generation/outputs/${gen.id}.${ext}`;
            finalVideoUrl = await uploadToR2(key, buffer, contentType);
          }
        } catch {
          // Keep Muapi URL if R2 upload fails
        }

        await db
          .update(schema.videoGenerations)
          .set({ videoUrl: finalVideoUrl, status: "completed", updatedAt: new Date() })
          .where(sameAttempt(gen));

        // Quality Control gate.
        await enqueueGateReview({
          sourceSystem: "video",
          sourceId: gen.id,
          clientId: gen.clientId,
          assetPath: finalVideoUrl,
          copyText: gen.script,
        });
        completed++;
      } else if (result.status === "failed") {
        await db
          .update(schema.videoGenerations)
          .set({
            status: "error",
            errorMessage: result.error || "Video generation failed",
            updatedAt: new Date(),
          })
          .where(sameAttempt(gen));
        failed++;
      } else if (result.status === "completed" && !result.videoUrl) {
        await db
          .update(schema.videoGenerations)
          .set({
            status: "error",
            errorMessage: "Video generation completed but no video was produced",
            updatedAt: new Date(),
          })
          .where(sameAttempt(gen));
        failed++;
      } else if (isProcessingAbandoned(gen)) {
        await failVideoGeneration(gen, processingAbandonedMessage(gen));
        failed++;
      } else {
        stillProcessing++;
      }
    } catch {
      // Transient provider error — skip this one, unless it has been failing for longer
      // than any render takes.
      if (isProcessingAbandoned(gen)) {
        await failVideoGeneration(gen, processingAbandonedMessage(gen)).catch(() => {});
        failed++;
      } else {
        stillProcessing++;
      }
    }
  }

  return NextResponse.json({
    swept: processing.length,
    completed,
    failed,
    stillProcessing,
    abandoned,
  });
}
