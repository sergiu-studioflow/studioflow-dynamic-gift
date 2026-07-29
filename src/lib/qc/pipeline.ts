// Async grading pipeline (FSM). Claims pending reviews with FOR UPDATE SKIP LOCKED, grades
// each, and writes the verdict back to the source row's qc_status — exception based:
// AI-pass → 'approved' (flows on untouched), AI-fail → 'flagged' (held for a human).
// A human override (overridden=true) always wins: the AI completion no-ops if the review
// was overridden mid-grade.
//
// Two lanes with separate budgets. A visual grade downloads an asset and calls a vision
// model (seconds, ~a cent). A text grade is one small completion (~2s, sub-cent) and
// Content Ideation emits 25 rows per request, so the text lane gets a much larger budget
// and runs with bounded concurrency — otherwise a single ideation run would take hours of
// cron ticks to clear.

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CLAIM_LIMITS, MAX_ATTEMPTS, TEXT_CONCURRENCY, TEXT_SYSTEMS, VISUAL_SYSTEMS, type SourceSystem } from "./constants";
import { isTransient } from "./claude";
import { runGateReview } from "./grade";
import { sourceTableFor } from "./enqueue";
import type { BrandGrounding } from "./grounding";

type ReviewRow = typeof schema.gateReviews.$inferSelect;

const setReview = (id: string, patch: Partial<ReviewRow>) =>
  db.update(schema.gateReviews).set({ ...patch, updatedAt: new Date() }).where(eq(schema.gateReviews.id, id));

/** Apply the AI verdict to the source row (exception-based auto-approve/flag). Only writes
 *  if the row still points at THIS review — a human override detaches or repoints it. */
async function applyVerdict(review: ReviewRow, overallPass: boolean): Promise<void> {
  if (!review.sourceId) return;
  const t = sourceTableFor(review.sourceSystem as SourceSystem);
  if (!t) return;
  await db
    .update(t.table)
    .set({ qcStatus: overallPass ? "approved" : "flagged", qcReviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(t.id, review.sourceId), eq(t.qcReviewId, review.id)));
}

/** Claim up to `limit` pending reviews in the given lane. SKIP LOCKED keeps concurrent
 *  ticks (UI pump + cron) from grabbing the same rows. */
async function claim(systems: readonly SourceSystem[], limit: number): Promise<ReviewRow[]> {
  if (limit <= 0) return [];
  const claimed = await db.execute(sql`
    UPDATE gate_reviews SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM gate_reviews
      WHERE status = 'pending'
        AND attempts < ${MAX_ATTEMPTS}
        AND source_system IN ${sql`(${sql.join(systems.map((s) => sql`${s}`), sql`, `)})`}
      ORDER BY created_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id`);
  const ids = (claimed as unknown as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];
  return db.select().from(schema.gateReviews).where(inArray(schema.gateReviews.id, ids));
}

/** Grade one claimed review and record the outcome. Never throws. */
async function runOne(review: ReviewRow, groundingCache: Map<string | null, BrandGrounding>): Promise<void> {
  try {
    const r = await runGateReview(review, groundingCache);
    // Write the verdict only if still running AND not human-overridden mid-grade.
    const done = await db
      .update(schema.gateReviews)
      .set({
        status: "complete",
        overallPass: r.overallPass,
        criteriaJson: r.criteria,
        reviewer: "ai",
        groundingSource: r.groundingSource,
        rulesetVersion: r.rulesetVersion,
        costCents: r.costCents,
        notes: r.advisoryNotes.length ? `Advisory: ${r.advisoryNotes.join(" · ")}` : null,
        errorMessage: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.gateReviews.id, review.id),
          eq(schema.gateReviews.status, "running"),
          eq(schema.gateReviews.overridden, false)
        )
      )
      .returning({ id: schema.gateReviews.id });
    if (!done.length) return; // overridden by a human or re-claimed elsewhere
    await applyVerdict(review, r.overallPass);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    if (isTransient(e)) {
      // Give the attempt back — a provider hiccup shouldn't burn a retry.
      await setReview(review.id, { status: "pending", attempts: Math.max(0, review.attempts - 1), errorMessage: msg });
    } else {
      const exhausted = review.attempts >= MAX_ATTEMPTS;
      await setReview(review.id, { status: exhausted ? "failed" : "pending", errorMessage: msg });
      // Permanent failure: flag the source for a human (fail-safe — never leave it
      // stranded 'pending'; flagged also stops the UI tick pump).
      if (exhausted) await applyVerdict(review, false);
    }
  }
}

/** Run an array of tasks with bounded concurrency. */
async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function claimAndRun(limits: { visual: number; text: number }): Promise<number> {
  const [visual, text] = await Promise.all([
    claim(VISUAL_SYSTEMS, limits.visual),
    claim(TEXT_SYSTEMS, limits.text),
  ]);
  if (!visual.length && !text.length) return 0;

  // Per-invocation grounding cache: same-client reviews in the batch reuse one
  // buildBrandGrounding result instead of re-querying the intel tables.
  const groundingCache = new Map<string | null, BrandGrounding>();

  // Visual grades are heavy and serialised; text grades are light and run concurrently.
  for (const review of visual) await runOne(review, groundingCache);
  await pool(text, TEXT_CONCURRENCY, (review) => runOne(review, groundingCache));

  return visual.length + text.length;
}

/** UI pump while a gallery / QC panel is open (small batch). */
export async function runGateTick(): Promise<number> {
  return claimAndRun(CLAIM_LIMITS.tick);
}

/** Cron backstop: a bigger batch + reconcile anything stuck. */
export async function runGateCron(): Promise<number> {
  const n = await claimAndRun(CLAIM_LIMITS.cron);
  await sweepStuck();
  return n;
}

/** Reconcile wedged reviews (>30 min pending/running): attempts left → release the claim
 *  back to 'pending' so claimAndRun retries; exhausted → fail the review AND flag the
 *  source for a human (fail-safe — a source must never sit 'pending' forever, and
 *  'flagged' stops the UI tick pump). */
export async function sweepStuck(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const stuck = await db
    .select()
    .from(schema.gateReviews)
    .where(and(inArray(schema.gateReviews.status, ["pending", "running"]), lt(schema.gateReviews.updatedAt, cutoff)));

  for (const review of stuck) {
    if (review.attempts < MAX_ATTEMPTS) {
      await setReview(review.id, { status: "pending", errorMessage: "Requeued (sweep: stuck run)" });
    } else {
      await setReview(review.id, { status: "failed", errorMessage: "Timed out (sweep)" });
      await applyVerdict(review, false); // flagged = held for a human
    }
  }
}
