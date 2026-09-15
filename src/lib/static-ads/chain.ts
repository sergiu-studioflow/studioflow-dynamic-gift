/**
 * Refined-chain orchestrator for the auto-refinement pipeline:
 *
 *   intermediate (Nano Banana) → logo-refined (GPT2 logo swap, only with a brand logo)
 *                              → refined (GPT2 product swap, the user-visible final)
 *
 * Shared by GET /api/static-ads/generate/[id] (the Create tab's per-tile poll) and
 * sweepGeneratingRows (gallery loads + the monthly-planning cron). Before this lived in the
 * route, only the Create tab advanced a chain, so leaving the tab stranded every final.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, gt, inArray, isNotNull, isNull, like, lt, or } from "drizzle-orm";
import {
  pollKieJob,
  submitGptImage2Job,
  REFINE_PROMPT,
  mapAspectForGpt2,
} from "@/lib/static-ads/kie-ai";
import { uploadToR2 } from "@/lib/r2";
import { BRAND_SLUG } from "@/lib/static-ads/config";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export type GenerationRow = typeof schema.staticAdGenerations.$inferSelect;
export type ChainedRow = GenerationRow & { kieState?: string };

const LOGO_REFINE_PROMPT = "Keep everything the same, swap the logo to the logo image attached";

const CHAIN_MODES = ["refined", "logo-refined"];

/**
 * Before a paid GPT Image 2 submission, a chain step claims its row by writing a `claim:`
 * token into kie_job_id (UPDATE … WHERE kie_job_id IS NULL). Only the claimer submits, so
 * concurrent advancers — tile polls, gallery sweeps, the cron — can never each fire a job.
 * A claim older than CLAIM_STALE_MS belongs to an invocation that died mid-submit and may be
 * taken over, so a crash can't strand the row either.
 */
const CLAIM_PREFIX = "claim:";
const CLAIM_STALE_MS = 2 * 60 * 1000;

function isClaimToken(kieJobId: string | null | undefined): boolean {
  return !!kieJobId && kieJobId.startsWith(CLAIM_PREFIX);
}

/** A fresh claim token, for code that inserts a chain row and submits its job itself. */
export function newChainClaimToken(): string {
  return `${CLAIM_PREFIX}${randomUUID()}`;
}

function hasSubmittedJob(row: GenerationRow): boolean {
  return !!row.kieJobId && !isClaimToken(row.kieJobId);
}

function hasLiveClaim(row: GenerationRow): boolean {
  return isClaimToken(row.kieJobId) && Date.now() - new Date(row.updatedAt).getTime() < CLAIM_STALE_MS;
}

/** A refined / logo-refined row still waiting on its upstream step before it can submit. */
export function isChainWaiter(row: GenerationRow): boolean {
  return (
    row.status === "pending" &&
    CHAIN_MODES.includes(row.mode) &&
    !!row.sourceGenerationId &&
    !hasSubmittedJob(row)
  );
}

/**
 * Chain waiters for a sweep. Only chain TAILS are returned: advanceChainStep recurses
 * upstream, so also advancing a waiter that is another waiter's source would just race
 * the same claim.
 */
export async function listChainWaiters(opts: {
  clientId?: string | null;
  createdAfter: Date;
  limit?: number;
}): Promise<GenerationRow[]> {
  const t = schema.staticAdGenerations;
  const conditions = [
    eq(t.status, "pending"),
    inArray(t.mode, CHAIN_MODES),
    isNotNull(t.sourceGenerationId),
    or(isNull(t.kieJobId), like(t.kieJobId, `${CLAIM_PREFIX}%`)),
    gt(t.createdAt, opts.createdAfter),
  ];
  if (opts.clientId) conditions.push(eq(t.clientId, opts.clientId));

  const rows = await db
    .select()
    .from(t)
    .where(and(...conditions))
    .limit(opts.limit ?? 200);

  const upstreamIds = new Set(rows.map((r) => r.sourceGenerationId));
  return rows.filter((r) => !upstreamIds.has(r.id));
}

/**
 * Advance one chain waiter. Polls the source's Kie job; on success eager-persists the
 * source to R2, marks it completed, then fires this row's GPT Image 2 step. Returns the
 * row with `kieState: 'waiting-source'` while the source is still in flight.
 */
export async function advanceChainStep(row: GenerationRow): Promise<ChainedRow> {
  // Another advancer is submitting this row's job right now.
  if (hasLiveClaim(row)) return { ...row, kieState: "submitting" };

  const [found] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, row.sourceGenerationId!))
    .limit(1);

  if (!found) return markChainError(row, "Source row missing");
  let source: GenerationRow = found;

  if (source.status === "error") {
    return markChainError(row, source.errorMessage || "Source step failed");
  }

  // Edge: source already completed (cold start / earlier poll). Skip the
  // Kie roundtrip and fire the next step immediately.
  if (source.status === "completed" && source.imageUrl) {
    return fireNextStep(row, source);
  }

  // Source has no Kie job of its own yet. Two sub-cases:
  //   a) source is itself a chain waiter (the DG 3-stage chain: intermediate →
  //      logo-refined → refined) — advance IT first, then re-check.
  //   b) genuine race (status='pending', no parent) — wait.
  if (!hasSubmittedJob(source)) {
    if (!isChainWaiter(source)) return { ...row, kieState: "waiting-source" };
    const advancedSource = await advanceChainStep(source);
    if (advancedSource.status === "error") {
      return markChainError(row, advancedSource.errorMessage || "Source step failed");
    }
    if (!hasSubmittedJob(advancedSource)) return { ...row, kieState: "waiting-source" };
    source = advancedSource;
  }

  let pollResult: Awaited<ReturnType<typeof pollKieJob>>;
  try {
    pollResult = await pollKieJob(source.kieJobId!);
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
    return markChainError(row, msg);
  }

  if (pollResult.state !== "success" || pollResult.resultUrls.length === 0) {
    // Still queued / processing.
    return { ...row, kieState: "waiting-source" };
  }

  // Source is done. Eager-persist it to R2, update the source row, then fire the next step.
  const sourceUrl = pollResult.resultUrls[0];
  let sourceR2Url = sourceUrl;
  try {
    sourceR2Url = await downloadAndUploadToR2(sourceUrl, source.id, source.clientId);
  } catch (uploadErr) {
    console.error(`[static-ads/r2] Eager persist of source ${source.id} failed:`, uploadErr);
    // Fall back to tempfile URL; the standalone polling branch will retry.
  }
  // qcStatus is written inline rather than going through enqueueGateReview: this row is a
  // refined-chain artifact (intermediate / logo-refined). It is hidden from the gallery and
  // never ships, so grading it would be wasted spend and a source of bogus flags — only the
  // final `refined` row is gated.
  const [persistedSource] = await db
    .update(schema.staticAdGenerations)
    .set({ status: "completed", imageUrl: sourceR2Url, qcStatus: "skipped", updatedAt: new Date() })
    .where(eq(schema.staticAdGenerations.id, source.id))
    .returning();

  return fireNextStep(row, persistedSource);
}

/** Dispatch the right "next-step" Kie submission based on row mode. */
function fireNextStep(row: GenerationRow, source: GenerationRow): Promise<ChainedRow> {
  if (row.mode === "logo-refined") return fireLogoSwap(row, source);
  return fireGpt2ForRefined(row, source);
}

/**
 * Fire the GPT Image 2 logo-swap job. The source is the Nano Banana intermediate, and the
 * logo is the client's color wordmark from clientStaticAdConfig. If the logo has
 * disappeared since the row was inserted, propagate that as an error so the chain
 * doesn't strand.
 */
async function fireLogoSwap(logoRefined: GenerationRow, intermediate: GenerationRow): Promise<ChainedRow> {
  const intermediateUrl = intermediate.imageUrl;
  if (!intermediateUrl) return markChainError(logoRefined, "Source variation has no image");
  if (!intermediate.clientId) return markChainError(logoRefined, "Source variation has no client attached");

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
    return markChainError(logoRefined, "Brand logo missing — was the clientStaticAdConfig row deleted?");
  }

  // Raw public R2 URLs — see fireGpt2ForRefined for the rationale (presigned
  // URLs expire before Kie's queue picks the job up).
  return submitClaimed(logoRefined, intermediateUrl, "GPT Image 2 logo-swap submission failed", () =>
    submitGptImage2Job({
      prompt: LOGO_REFINE_PROMPT,
      inputUrls: [intermediateUrl, logoUrl],
      aspectRatio: mapAspectForGpt2(intermediate.aspectRatio),
      resolution: intermediate.resolution || "2K",
    })
  );
}

/** Fire the GPT Image 2 product-swap job for a refined row whose source is now ready. */
async function fireGpt2ForRefined(refined: GenerationRow, intermediate: GenerationRow): Promise<ChainedRow> {
  const varUrl = intermediate.imageUrl;
  if (!varUrl) return markChainError(refined, "Source variation has no image");
  if (!intermediate.productId) return markChainError(refined, "Source variation has no product attached");

  const [product] = await db
    .select()
    .from(schema.clientProducts)
    .where(eq(schema.clientProducts.id, intermediate.productId))
    .limit(1);

  const prodUrl = product?.imageUrl;
  if (!prodUrl) return markChainError(refined, "Product image missing for refinement");

  // Pass the public R2 URLs directly to GPT Image 2 — DO NOT presign.
  // Presigned URLs expire after 10 min; if Kie's queue takes longer than that
  // to download, the input image fetch 403s and the job fails. The public
  // r2.dev URL doesn't expire.
  return submitClaimed(refined, varUrl, "GPT Image 2 submission failed", () =>
    submitGptImage2Job({
      prompt: REFINE_PROMPT,
      inputUrls: [varUrl, prodUrl],
      aspectRatio: mapAspectForGpt2(intermediate.aspectRatio),
      resolution: intermediate.resolution || "2K",
    })
  );
}

/** Claim → submit → record. Losing the claim means another advancer owns the submission. */
async function submitClaimed(
  row: GenerationRow,
  referenceImageUrl: string,
  fallbackError: string,
  submit: () => Promise<{ taskId: string }>
): Promise<ChainedRow> {
  const token = await claimRow(row.id);
  if (!token) return latestRow(row);

  let taskId: string;
  try {
    ({ taskId } = await submit());
  } catch (err) {
    const message = err instanceof Error ? err.message : fallbackError;
    const [failed] = await db
      .update(schema.staticAdGenerations)
      .set({ status: "error", errorMessage: message, kieJobId: null, updatedAt: new Date() })
      .where(and(eq(schema.staticAdGenerations.id, row.id), eq(schema.staticAdGenerations.kieJobId, token)))
      .returning();
    return failed ?? latestRow(row);
  }

  const [updated] = await db
    .update(schema.staticAdGenerations)
    .set({
      kieJobId: taskId,
      status: "generating",
      referenceImageUrl, // overwrite the placeholder with the actual input
      updatedAt: new Date(),
    })
    .where(and(eq(schema.staticAdGenerations.id, row.id), eq(schema.staticAdGenerations.kieJobId, token)))
    .returning();
  if (updated) return updated;

  console.warn(`[static-ads/chain] claim on ${row.id} was taken over before Kie task ${taskId} was recorded`);
  return latestRow(row);
}

async function claimRow(rowId: string): Promise<string | null> {
  const t = schema.staticAdGenerations;
  const token = newChainClaimToken();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const claimed = await db
    .update(t)
    .set({ kieJobId: token, updatedAt: new Date() })
    .where(
      and(
        eq(t.id, rowId),
        eq(t.status, "pending"),
        or(isNull(t.kieJobId), and(like(t.kieJobId, `${CLAIM_PREFIX}%`), lt(t.updatedAt, staleBefore)))
      )
    )
    .returning({ id: t.id });
  return claimed.length > 0 ? token : null;
}

/**
 * Fail a waiting chain row. Guarded on status='pending' so a row another advancer already
 * submitted is never clobbered; clearing kie_job_id voids any stale claim token.
 */
async function markChainError(row: GenerationRow, message: string): Promise<ChainedRow> {
  const [updated] = await db
    .update(schema.staticAdGenerations)
    .set({ status: "error", errorMessage: message, kieJobId: null, updatedAt: new Date() })
    .where(and(eq(schema.staticAdGenerations.id, row.id), eq(schema.staticAdGenerations.status, "pending")))
    .returning();
  return updated ?? latestRow(row);
}

async function latestRow(row: GenerationRow): Promise<ChainedRow> {
  const [latest] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, row.id))
    .limit(1);
  return latest ?? row;
}

export async function downloadAndUploadToR2(
  sourceUrl: string,
  generationId: string,
  clientId: string | null
): Promise<string> {
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
