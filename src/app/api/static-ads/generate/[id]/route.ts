import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  pollKieJob,
  submitGptImage2Job,
  REFINE_PROMPT,
  mapAspectForGpt2,
} from "@/lib/static-ads/kie-ai";
import { uploadToR2, toAccessibleUrl } from "@/lib/r2";
import { BRAND_SLUG } from "@/lib/static-ads/config";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

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

    // NEW: refined row waiting on its source intermediate. Polling this id
    // advances the chain (Nano Banana → GPT Image 2) on the server side so
    // the frontend can stay simple and just keep polling one id per tile.
    if (
      generation.status === "pending" &&
      (generation.mode === "refined" || generation.mode === "logo-refined") &&
      generation.sourceGenerationId &&
      !generation.kieJobId
    ) {
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

type GenerationRow = typeof schema.staticAdGenerations.$inferSelect;

const LOGO_REFINE_PROMPT = "Keep everything the same, swap the logo to the logo image attached";

/**
 * Chain orchestrator for the auto-refinement pipeline.
 *
 * Handles two chain step types in one place because the source-waiting logic
 * is identical — only the "fire next Kie job" call differs:
 *
 *   mode='logo-refined' → fires `fireLogoSwap`  (GPT2 logo swap)
 *                         source = intermediate (Nano Banana variation)
 *   mode='refined'      → fires `fireGpt2ForRefined` (GPT2 product swap)
 *                         source = logo-refined when present, else intermediate
 *
 * Called when /generate/[id] is polled for either row with `kie_job_id=NULL`.
 * Polls the source's Kie job; on success, eager-persists the source to R2,
 * updates the source row, then fires the next step. Returns the row with a
 * `kieState: 'waiting-source'` hint while the source is still in flight.
 *
 * Race-protected: each fire function guards its UPDATE with
 * `WHERE kie_job_id IS NULL RETURNING` so concurrent polls can't double-fire.
 */
async function advanceChainStep(row: GenerationRow): Promise<GenerationRow & { kieState?: string }> {
  const sourceId = row.sourceGenerationId!;
  const [source] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, sourceId))
    .limit(1);

  if (!source) {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({ status: "error", errorMessage: "Source row missing", updatedAt: new Date() })
      .where(eq(schema.staticAdGenerations.id, row.id))
      .returning();
    return updated;
  }

  if (source.status === "error") {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: source.errorMessage || "Source step failed",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, row.id))
      .returning();
    return updated;
  }

  // Edge: source already completed (cold start / earlier poll). Skip the
  // Kie roundtrip and fire the next step immediately.
  if (source.status === "completed" && source.imageUrl) {
    return await fireNextStep(row, source);
  }

  // Otherwise source.status === "generating" (or "pending" awaiting its
  // own Kie submission — rare race; treat as still-waiting).
  if (!source.kieJobId) {
    return { ...row, kieState: "waiting-source" };
  }

  let pollResult: Awaited<ReturnType<typeof pollKieJob>>;
  try {
    pollResult = await pollKieJob(source.kieJobId);
  } catch (err) {
    console.error("[static-ads/chain] poll source error:", err);
    return { ...row, kieState: "waiting-source" };
  }

  if (pollResult.state === "failed") {
    const msg = pollResult.errorMessage || "Source step failed";
    await db
      .update(schema.staticAdGenerations)
      .set({ status: "error", errorMessage: msg, updatedAt: new Date() })
      .where(eq(schema.staticAdGenerations.id, source.id));
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({ status: "error", errorMessage: msg, updatedAt: new Date() })
      .where(eq(schema.staticAdGenerations.id, row.id))
      .returning();
    return updated;
  }

  if (pollResult.state !== "success" || pollResult.resultUrls.length === 0) {
    // Still queued / processing.
    return { ...row, kieState: "waiting-source" };
  }

  // Source is done. Eager-persist it to R2 (same pattern as the standalone
  // success branch above), update the source row, then fire the next step.
  const sourceUrl = pollResult.resultUrls[0];
  let sourceR2Url = sourceUrl;
  try {
    sourceR2Url = await downloadAndUploadToR2(sourceUrl, source.id, source.clientId);
  } catch (uploadErr) {
    console.error(`[static-ads/r2] Eager persist of source ${source.id} failed:`, uploadErr);
    // Fall back to tempfile URL; the standalone polling branch will retry.
  }
  const [persistedSource] = await db
    .update(schema.staticAdGenerations)
    .set({ status: "completed", imageUrl: sourceR2Url, updatedAt: new Date() })
    .where(eq(schema.staticAdGenerations.id, source.id))
    .returning();

  return await fireNextStep(row, persistedSource);
}

/** Dispatch the right "next-step" Kie submission based on row mode. */
async function fireNextStep(
  row: GenerationRow,
  source: GenerationRow
): Promise<GenerationRow & { kieState?: string }> {
  if (row.mode === "logo-refined") return fireLogoSwap(row, source);
  return fireGpt2ForRefined(row, source);
}

/**
 * Fire the GPT Image 2 logo-swap job. The source is the Nano Banana
 * intermediate, and we look up the client's color wordmark from
 * clientStaticAdConfig. If the logo has disappeared between row insertion
 * and now, propagate that as an error so the chain doesn't strand.
 * Race-guarded via UPDATE ... WHERE kie_job_id IS NULL.
 */
async function fireLogoSwap(
  logoRefined: GenerationRow,
  intermediate: GenerationRow
): Promise<GenerationRow & { kieState?: string }> {
  if (!intermediate.imageUrl) {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: "Source variation has no image",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, logoRefined.id))
      .returning();
    return updated;
  }

  if (!intermediate.clientId) {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: "Source variation has no client attached",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, logoRefined.id))
      .returning();
    return updated;
  }

  const [brandConfig] = await db
    .select({
      brandLogoUrl: schema.clientStaticAdConfig.brandLogoUrl,
      brandLogoWhiteUrl: schema.clientStaticAdConfig.brandLogoWhiteUrl,
    })
    .from(schema.clientStaticAdConfig)
    .where(eq(schema.clientStaticAdConfig.clientId, intermediate.clientId))
    .limit(1);
  const logoUrl = brandConfig?.brandLogoUrl || brandConfig?.brandLogoWhiteUrl || null;

  if (!logoUrl) {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: "Brand logo missing — was the clientStaticAdConfig row deleted?",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, logoRefined.id))
      .returning();
    return updated;
  }

  // Raw public R2 URLs — see fireGpt2ForRefined for the rationale (presigned
  // URLs expire before Kie's queue picks the job up).
  let kieResult: Awaited<ReturnType<typeof submitGptImage2Job>>;
  try {
    kieResult = await submitGptImage2Job({
      prompt: LOGO_REFINE_PROMPT,
      inputUrls: [intermediate.imageUrl, logoUrl],
      aspectRatio: mapAspectForGpt2(intermediate.aspectRatio),
      resolution: intermediate.resolution || "2K",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GPT Image 2 logo-swap submission failed";
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({ status: "error", errorMessage: message, updatedAt: new Date() })
      .where(eq(schema.staticAdGenerations.id, logoRefined.id))
      .returning();
    return updated;
  }

  // Race guard: only the first concurrent poller's UPDATE returns a row.
  const updated = await db
    .update(schema.staticAdGenerations)
    .set({
      kieJobId: kieResult.taskId,
      status: "generating",
      referenceImageUrl: intermediate.imageUrl,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.staticAdGenerations.id, logoRefined.id),
        isNull(schema.staticAdGenerations.kieJobId)
      )
    )
    .returning();

  if (updated.length > 0) {
    return updated[0];
  }

  const [latest] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, logoRefined.id))
    .limit(1);
  return latest ?? logoRefined;
}

/**
 * Fire the GPT Image 2 job for a refined row whose intermediate is now ready.
 * Race-guarded via UPDATE ... WHERE kie_job_id IS NULL.
 */
async function fireGpt2ForRefined(
  refined: GenerationRow,
  intermediate: GenerationRow
): Promise<GenerationRow & { kieState?: string }> {
  if (!intermediate.imageUrl) {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: "Source variation has no image",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, refined.id))
      .returning();
    return updated;
  }

  if (!intermediate.productId) {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: "Source variation has no product attached",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, refined.id))
      .returning();
    return updated;
  }

  const [product] = await db
    .select()
    .from(schema.clientProducts)
    .where(eq(schema.clientProducts.id, intermediate.productId))
    .limit(1);

  if (!product || !product.imageUrl) {
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: "Product image missing for refinement",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, refined.id))
      .returning();
    return updated;
  }

  // Pass the public R2 URLs directly to GPT Image 2 — DO NOT presign.
  // Presigned URLs expire after 10 min; if Kie's queue takes longer than that
  // to download, the input image fetch 403s and the job fails. The public
  // r2.dev URL doesn't expire.
  const varUrl = intermediate.imageUrl;
  const prodUrl = product.imageUrl;

  let kieResult: Awaited<ReturnType<typeof submitGptImage2Job>>;
  try {
    kieResult = await submitGptImage2Job({
      prompt: REFINE_PROMPT,
      inputUrls: [varUrl, prodUrl],
      aspectRatio: mapAspectForGpt2(intermediate.aspectRatio),
      resolution: intermediate.resolution || "2K",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GPT Image 2 submission failed";
    const [updated] = await db
      .update(schema.staticAdGenerations)
      .set({ status: "error", errorMessage: message, updatedAt: new Date() })
      .where(eq(schema.staticAdGenerations.id, refined.id))
      .returning();
    return updated;
  }

  // Race guard: only the first concurrent poller's UPDATE returns a row.
  // The others get an empty RETURNING because kie_job_id is no longer NULL.
  const updated = await db
    .update(schema.staticAdGenerations)
    .set({
      kieJobId: kieResult.taskId,
      status: "generating",
      referenceImageUrl: intermediate.imageUrl, // overwrite placeholder
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.staticAdGenerations.id, refined.id),
        isNull(schema.staticAdGenerations.kieJobId)
      )
    )
    .returning();

  if (updated.length > 0) {
    return updated[0];
  }

  // Lost the race — another concurrent poll already advanced this refined row.
  // Re-read the row and return whatever the winning poll set up.
  const [latest] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, refined.id))
    .limit(1);
  return latest ?? refined;
}

async function downloadAndUploadToR2(sourceUrl: string, generationId: string, clientId: string | null): Promise<string> {
  // Retry up to 3 times
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/png";
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      // Per-client R2 prefix when clientId is set; falls back to agency-level for single-brand portals.
      const clientPrefix = clientId ? await getClientStoragePrefix(clientId) : null;
      const basePrefix = clientPrefix || `brands/${BRAND_SLUG}`;
      const key = `${basePrefix}/static-ad-system/generated-ads/${generationId}.${ext}`;

      return await uploadToR2(key, buffer, contentType);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("Download failed after 3 attempts");
}
