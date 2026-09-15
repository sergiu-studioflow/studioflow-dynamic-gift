import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { pollKieJob } from "@/lib/static-ads/kie-ai";
import { toAccessibleUrl } from "@/lib/r2";
import { enqueueGateReview } from "@/lib/qc/enqueue";
import { advanceChainStep, downloadAndUploadToR2, isChainWaiter } from "@/lib/static-ads/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Add presigned URLs to a generation record for frontend display */
async function withPresignedUrls<T extends { imageUrl?: string | null; thumbnailUrl?: string | null }>(
  gen: T
): Promise<T> {
  return {
    ...gen,
    imageUrl: gen.imageUrl ? await toAccessibleUrl(gen.imageUrl) : gen.imageUrl,
    thumbnailUrl: gen.thumbnailUrl ? await toAccessibleUrl(gen.thumbnailUrl) : gen.thumbnailUrl,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [generation] = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.id, id))
      .limit(1);

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }

    // If errored, return current state
    if (generation.status === "error") {
      return NextResponse.json(generation);
    }

    // If completed but still on temp URL, persist to R2
    if (
      generation.status === "completed" &&
      generation.imageUrl &&
      !generation.imageUrl.includes("r2.dev") &&
      !generation.imageUrl.includes("studio-flow.co")
    ) {
      try {
        const r2Url = await downloadAndUploadToR2(generation.imageUrl, generation.id, generation.clientId);
        const [updated] = await db
          .update(schema.staticAdGenerations)
          .set({ imageUrl: r2Url, updatedAt: new Date() })
          .where(eq(schema.staticAdGenerations.id, generation.id))
          .returning();
        console.log(`[static-ads/r2] Persisted ${generation.id} to R2`);
        // The asset only just became durable — enqueue now (the eager path skipped it
        // because a tempfile URL is not gradable).
        await enqueueGateReview({
          sourceSystem: "static",
          sourceId: updated.id,
          clientId: updated.clientId,
          assetPath: updated.imageUrl,
          copyText: updated.adCopy,
          mode: updated.mode,
        });
        return NextResponse.json(await withPresignedUrls(updated));
      } catch (err) {
        console.error(`[static-ads/r2] Failed to persist ${generation.id}:`, err);
        // Still return the temp URL — next poll will retry
        return NextResponse.json(generation);
      }
    }

    // If completed with R2 URL, return with presigned URL
    if (generation.status === "completed") {
      return NextResponse.json(await withPresignedUrls(generation));
    }

    // Refined row waiting on its source step. Polling this id advances the chain
    // (Nano Banana → GPT Image 2). The same step also runs from sweepGeneratingRows, so
    // the chain keeps moving after the user leaves the Create tab.
    if (isChainWaiter(generation)) {
      const chained = await advanceChainStep(generation);
      return NextResponse.json(await withPresignedUrls(chained));
    }

    // If generating and has a Kie job ID, poll for status
    if (generation.status === "generating" && generation.kieJobId) {
      try {
        const result = await pollKieJob(generation.kieJobId);

        if (result.state === "success" && result.resultUrls.length > 0) {
          const sourceUrl = result.resultUrls[0];

          // Eager R2 persistence: download from Kie tempfile and upload to R2
          // before flipping status to "completed". This guarantees imageUrl in
          // the DB is always an R2 URL — Download / Save-to-Winners / Edit all
          // depend on this, and lazy persistence dropped ads when the user
          // left before the follow-up poll fired.
          let persistedUrl = sourceUrl;
          try {
            persistedUrl = await downloadAndUploadToR2(sourceUrl, generation.id, generation.clientId);
          } catch (uploadErr) {
            // R2 upload failed after 3 retries — fall back to tempfile URL and
            // let the lazy-persist branch above retry on the next poll.
            console.error(`[static-ads/r2] Eager persist failed for ${generation.id}:`, uploadErr);
          }

          const [updated] = await db
            .update(schema.staticAdGenerations)
            .set({
              status: "completed",
              imageUrl: persistedUrl,
              updatedAt: new Date(),
            })
            .where(eq(schema.staticAdGenerations.id, generation.id))
            .returning();

          // Quality Control gate. If the R2 upload above fell back to a tempfile URL,
          // enqueue no-ops and the lazy-persist branch re-enqueues once R2 lands.
          await enqueueGateReview({
            sourceSystem: "static",
            sourceId: updated.id,
            clientId: updated.clientId,
            assetPath: updated.imageUrl,
            copyText: updated.adCopy,
            mode: updated.mode,
          });

          return NextResponse.json(await withPresignedUrls(updated));
        }

        if (result.state === "failed") {
          const [updated] = await db
            .update(schema.staticAdGenerations)
            .set({
              status: "error",
              errorMessage: result.errorMessage || "Generation failed",
              updatedAt: new Date(),
            })
            .where(eq(schema.staticAdGenerations.id, generation.id))
            .returning();

          return NextResponse.json(updated);
        }

        // Still processing — return current state
        return NextResponse.json({
          ...generation,
          kieState: result.state,
        });
      } catch (pollErr) {
        console.error("[static-ads/poll] Poll error:", pollErr);
        // Transient poll error — don't mark as failed, just return current state
        return NextResponse.json(generation);
      }
    }

    return NextResponse.json(generation);
  } catch (err) {
    console.error("[static-ads/generate/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
