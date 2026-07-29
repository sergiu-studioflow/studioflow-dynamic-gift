// Fire-and-forget enqueue of a gate review when a piece finishes generating. Idempotent:
// the unique index on (source_system, source_id) + the `qc_review_id IS NULL` guard make
// repeated polls / re-entry create exactly one review per output row. Never throws into the
// generation flow — QC must never break generation.
//
// Guards, in order:
//   - Mode guard: refined-chain artifacts (intermediate / logo-refined) are auto-'skipped'
//     instead of enqueued; they never ship as ads.
//   - Durability guard (VISUAL ONLY): a tempfile URL is not enqueued, because the judge
//     needs a durable R2 asset. The lazy-persist branch re-calls enqueue once the R2 URL
//     lands. Text reviews have no asset and must enqueue without one.

import { and, eq, isNull, type AnyColumn } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { r2KeyFromUrl } from "@/lib/r2";
import { QC_EXEMPT_STATIC_MODES, laneFor, type SourceSystem } from "./constants";

/** Which table + qc columns each source system writes to. One place to extend. */
type SourceTable = {
  table: typeof schema.staticAdGenerations | typeof schema.videoGenerations | typeof schema.generatedAdCopy | typeof schema.generatedVideoBriefs | typeof schema.contentIdeas;
  id: AnyColumn;
  qcStatus: AnyColumn;
  qcReviewId: AnyColumn;
};

export function sourceTableFor(sourceSystem: SourceSystem): SourceTable | null {
  switch (sourceSystem) {
    case "static":
      return { table: schema.staticAdGenerations, id: schema.staticAdGenerations.id, qcStatus: schema.staticAdGenerations.qcStatus, qcReviewId: schema.staticAdGenerations.qcReviewId };
    case "video":
      return { table: schema.videoGenerations, id: schema.videoGenerations.id, qcStatus: schema.videoGenerations.qcStatus, qcReviewId: schema.videoGenerations.qcReviewId };
    case "ad_copy":
      return { table: schema.generatedAdCopy, id: schema.generatedAdCopy.id, qcStatus: schema.generatedAdCopy.qcStatus, qcReviewId: schema.generatedAdCopy.qcReviewId };
    case "video_brief":
      return { table: schema.generatedVideoBriefs, id: schema.generatedVideoBriefs.id, qcStatus: schema.generatedVideoBriefs.qcStatus, qcReviewId: schema.generatedVideoBriefs.qcReviewId };
    case "ideation":
      return { table: schema.contentIdeas, id: schema.contentIdeas.id, qcStatus: schema.contentIdeas.qcStatus, qcReviewId: schema.contentIdeas.qcReviewId };
    default:
      return null;
  }
}

/** Point a source row at its review and mark it pending. Guarded by qc_review_id IS NULL
 *  so a human override that repointed the row is never clobbered. */
export async function setSourcePending(sourceSystem: SourceSystem, sourceId: string, reviewId: string): Promise<void> {
  const t = sourceTableFor(sourceSystem);
  if (!t) return;
  await db
    .update(t.table)
    .set({ qcStatus: "pending", qcReviewId: reviewId, updatedAt: new Date() })
    .where(and(eq(t.id, sourceId), isNull(t.qcReviewId)));
}

/** Mark a source row exempt. Guarded on qc_status='pending' so a real verdict is never lost. */
export async function setSourceSkipped(sourceSystem: SourceSystem, sourceId: string): Promise<void> {
  const t = sourceTableFor(sourceSystem);
  if (!t) return;
  await db
    .update(t.table)
    .set({ qcStatus: "skipped", updatedAt: new Date() })
    .where(and(eq(t.id, sourceId), eq(t.qcStatus, "pending")));
}

export async function enqueueGateReview(o: {
  sourceSystem: SourceSystem;
  sourceId: string;
  clientId: string | null;
  assetPath?: string | null;
  copyText?: string | null;
  /** The source row's mode — lets the guard skip exempt modes without a DB read. */
  mode?: string | null;
}): Promise<void> {
  try {
    if (!o.sourceId) return;
    const lane = laneFor(o.sourceSystem);

    // Refined-chain artifacts are marked skipped (shippable) and never graded.
    if (o.sourceSystem === "static" && o.mode && QC_EXEMPT_STATIC_MODES.includes(o.mode)) {
      await setSourceSkipped(o.sourceSystem, o.sourceId);
      return;
    }

    // Visual lane needs a durable asset. Tempfile fallbacks re-enqueue from the
    // lazy-persist branch once the R2 upload lands.
    if (lane === "visual" && (!o.assetPath || !r2KeyFromUrl(o.assetPath))) return;

    // Per-client config version snapshot (the ruleset that will ground this grade).
    const cfg = o.clientId
      ? (
          await db
            .select({ version: schema.complianceConfig.version })
            .from(schema.complianceConfig)
            .where(eq(schema.complianceConfig.clientId, o.clientId))
            .limit(1)
        )[0]
      : undefined;

    const [row] = await db
      .insert(schema.gateReviews)
      .values({
        clientId: o.clientId ?? null,
        sourceSystem: o.sourceSystem,
        sourceId: o.sourceId,
        assetPath: o.assetPath ?? null,
        copyText: o.copyText ?? null,
        status: "pending",
        groundingSource: cfg ? "flat" : "none",
        rulesetVersion: cfg?.version ?? null,
      })
      .onConflictDoNothing({ target: [schema.gateReviews.sourceSystem, schema.gateReviews.sourceId] })
      .returning({ id: schema.gateReviews.id });

    if (!row) return; // already enqueued — idempotent no-op
    await setSourcePending(o.sourceSystem, o.sourceId, row.id);
  } catch (e) {
    console.warn("[qc] enqueueGateReview failed", String(e).slice(0, 200));
  }
}

/** Enqueue a batch of text rows from one n8n completion webhook. Sequential by design:
 *  these run inside a webhook handler and the inserts are tiny. */
export async function enqueueTextBatch(
  sourceSystem: SourceSystem,
  rows: Array<{ id: string; copyText?: string | null }>,
  clientId: string | null
): Promise<void> {
  for (const row of rows) {
    await enqueueGateReview({ sourceSystem, sourceId: row.id, clientId, copyText: row.copyText ?? null });
  }
}
