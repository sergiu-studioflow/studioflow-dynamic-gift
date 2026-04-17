import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pollVideoJob } from "@/lib/video-generation/video-provider";
import { uploadToR2, r2Key } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/video-generation/sweep
 *
 * Checks all "processing" generations against Muapi and updates
 * any that have completed or failed. This catches generations that
 * finished while the user wasn't polling (navigated away, closed tab,
 * long generation times).
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const processing = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.status, "processing"));

  let completed = 0;
  let failed = 0;
  let stillProcessing = 0;

  for (const gen of processing) {
    if (!gen.muapiRequestId) continue;

    try {
      const result = await pollVideoJob(gen.muapiRequestId);

      if (result.status === "completed" && result.videoUrl && result.videoUrl.length > 0) {
        // Download and persist to R2
        let finalVideoUrl = result.videoUrl;
        try {
          const videoRes = await fetch(result.videoUrl);
          if (videoRes.ok) {
            const buffer = Buffer.from(await videoRes.arrayBuffer());
            const contentType = videoRes.headers.get("content-type") || "video/mp4";
            const ext = contentType.includes("webm") ? "webm" : "mp4";
            const prefix = gen.clientId
              ? (await getClientStoragePrefix(gen.clientId)) || "web-profits"
              : "web-profits";
            const key = r2Key(prefix, "video-generation/outputs", `${gen.id}.${ext}`);
            finalVideoUrl = await uploadToR2(key, buffer, contentType);
          }
        } catch {
          // Keep Muapi URL if R2 upload fails
        }

        await db
          .update(schema.videoGenerations)
          .set({ videoUrl: finalVideoUrl, status: "completed", updatedAt: new Date() })
          .where(eq(schema.videoGenerations.id, gen.id));
        completed++;
      } else if (result.status === "failed") {
        await db
          .update(schema.videoGenerations)
          .set({
            status: "error",
            errorMessage: result.error || "Video generation failed",
            updatedAt: new Date(),
          })
          .where(eq(schema.videoGenerations.id, gen.id));
        failed++;
      } else if (result.status === "completed" && !result.videoUrl) {
        await db
          .update(schema.videoGenerations)
          .set({
            status: "error",
            errorMessage: "Video generation completed but no video was produced",
            updatedAt: new Date(),
          })
          .where(eq(schema.videoGenerations.id, gen.id));
        failed++;
      } else {
        stillProcessing++;
      }
    } catch {
      // Transient Muapi error — skip this one
      stillProcessing++;
    }
  }

  return NextResponse.json({
    swept: processing.length,
    completed,
    failed,
    stillProcessing,
  });
}
