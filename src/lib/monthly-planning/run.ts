/**
 * Monthly Planning cron stepper. One tick (from /api/cron/monthly-planning-sweep, every
 * 30 min during Sydney daytime) advances every active plan, and only *starts* work whose
 * worst case still fits inside the route's 300 s maxDuration.
 *
 * Stages (all gated by user actions that set the plan status):
 *   planning  → continue a plan whose background planner stopped (see planner.ts)
 *   briefing  → generate briefs for planned items → briefs_ready
 *   producing → claim static slots and produce them in parallel / mark video generated
 *             → schedule completed, QC-cleared ads → complete
 *
 * Nothing paid is resubmitted automatically: a slot is claimed (status producing, no
 * generation yet) before its Claude/Kie calls, and a claim whose run died surfaces as an
 * error with a Retry action on the plan item.
 */

import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getApiKey } from "@/lib/api-keys";
import { pollAndPersistGeneration, sweepGeneratingRows } from "@/lib/static-ads/poll-and-persist";
import { pollKieJob } from "@/lib/static-ads/kie-ai";
import { generateBrief } from "./briefs";
import { produceStaticItem } from "./produce";
import { scheduleGeneratedItem } from "./schedule";
import { sweepStalePlanning } from "./planner";

/** Stay clear of the route's 300 s maxDuration. */
const TICK_LIMIT_MS = 280_000;
const STEP_CAP = 6; // briefs per plan per tick
/** Static slots produced in parallel per tick, across all plans. */
const PRODUCE_PER_TICK = 4;
/** Agent 1 + Agent 2 + the Kie submit take ~2–4 min, so production only starts early in a tick. */
const PRODUCE_START_DEADLINE_MS = 60_000;
/** Queueing a post: media probe + Instagram JPEG + one caption call. */
const SCHEDULE_RESERVE_MS = 90_000;
const BRIEF_RESERVE_MS = 75_000;
/**
 * A Kie job still generating this long after submit is lost. Four cron ticks: comfortably
 * past the normal ~2 min and past a missed tick. Waiting on a QC verdict never counts.
 */
const GENERATION_TIMEOUT_MINUTES = 120;
/** A claimed slot with no generation after this long belongs to a run that died (maxDuration is 5 min). */
const CLAIM_STALE_MINUTES = 15;
/** An item left 'briefing' this long by a regenerate call that died is briefed again. */
const BRIEFING_STALE_MINUTES = 15;

export type MonthlyRunResult = {
  plansPlanned: number;
  briefsGenerated: number;
  produced: number;
  scheduled: number;
  videoFinalised: number;
  plansCompleted: number;
  stuckFailed: number;
  dryRun: boolean;
};

type Plan = typeof schema.monthlyPlans.$inferSelect;
type PlanItem = typeof schema.planItems.$inferSelect;
type Clock = { elapsed: () => number; canStart: (reserveMs: number) => boolean };

const isDone = (status: string | null) => status === "completed" || status === "complete";
/** Same test as poll-and-persist: an image not yet copied off Kie's temporary host. */
const onDurableStorage = (url: string | null) => !!url && /r2\.dev|r2\.cloudflarestorage\.com|studio-flow\.co/.test(url);

export async function runMonthlyPlanning(opts: { dryRun?: boolean } = {}): Promise<MonthlyRunResult> {
  const dryRun = !!opts.dryRun;
  const res: MonthlyRunResult = {
    plansPlanned: 0, briefsGenerated: 0, produced: 0, scheduled: 0, videoFinalised: 0, plansCompleted: 0, stuckFailed: 0, dryRun,
  };
  const start = Date.now();
  const clock: Clock = {
    elapsed: () => Date.now() - start,
    canStart: (reserveMs) => Date.now() - start + reserveMs < TICK_LIMIT_MS,
  };

  // Always poll in-flight generations first (cheap, advances producing items).
  if (!dryRun) await sweepGeneratingRows({});

  const plans = await db
    .select()
    .from(schema.monthlyPlans)
    .where(inArray(schema.monthlyPlans.status, ["briefing", "producing"]))
    .orderBy(asc(schema.monthlyPlans.createdAt))
    .limit(20);
  const producing = plans.filter((p) => p.status === "producing");
  const briefing = plans.filter((p) => p.status === "briefing");

  // 1. Production is the long pole: start it first and let it run while the tick continues.
  const production = dryRun ? [] : await startProduction(producing, res, clock);

  // 2. Plans whose background planner stopped — a user is waiting on these.
  if (!dryRun) {
    try {
      res.plansPlanned += await sweepStalePlanning(clock.canStart);
    } catch (err) {
      console.error("[monthly-planning] planning sweep failed:", err);
    }
  }

  // 3. Schedule / time out in-flight slots.
  for (const plan of producing) {
    try {
      await advanceProducing(plan, dryRun, res, clock);
    } catch (err) {
      console.error(`[monthly-planning] plan ${plan.id} advance failed:`, err);
    }
  }

  // 4. Briefs.
  if (briefing.length) {
    const apiKey = await getApiKey("ANTHROPIC_API_KEY");
    for (const plan of briefing) {
      try {
        await stepBriefing(plan, apiKey, dryRun, res, clock);
      } catch (err) {
        console.error(`[monthly-planning] plan ${plan.id} briefing failed:`, err);
      }
    }
  }

  // 5. Let production finish, then roll each plan up.
  await Promise.allSettled(production);
  for (const plan of producing) {
    try {
      await rollUp(plan, dryRun, res);
    } catch (err) {
      console.error(`[monthly-planning] plan ${plan.id} roll-up failed:`, err);
    }
  }

  return res;
}

async function stepBriefing(plan: Plan, apiKey: string, dryRun: boolean, res: MonthlyRunResult, clock: Clock) {
  // Planned items, plus any left 'briefing' by a regenerate call that died mid-way.
  const staleBriefing = new Date(Date.now() - BRIEFING_STALE_MINUTES * 60_000);
  const planned = await db
    .select()
    .from(schema.planItems)
    .where(
      and(
        eq(schema.planItems.planId, plan.id),
        or(
          eq(schema.planItems.status, "planned"),
          and(eq(schema.planItems.status, "briefing"), lt(schema.planItems.updatedAt, staleBriefing))
        )
      )
    )
    .orderBy(asc(schema.planItems.sortOrder))
    .limit(STEP_CAP);

  if (!dryRun) {
    for (const item of planned) {
      if (!clock.canStart(BRIEF_RESERVE_MS)) break;
      await generateBrief(item, apiKey);
      res.briefsGenerated++;
    }
  }

  // If no planned/briefing items remain → briefs are ready.
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(schema.planItems)
    .where(and(eq(schema.planItems.planId, plan.id), inArray(schema.planItems.status, ["planned", "briefing"])));
  if (!dryRun && remaining === 0) {
    await db
      .update(schema.monthlyPlans)
      .set({ status: "briefs_ready", updatedAt: new Date() })
      .where(and(eq(schema.monthlyPlans.id, plan.id), eq(schema.monthlyPlans.status, "briefing")));
  }
}

/** Claim the next static slots across producing plans and start producing them in parallel. */
async function startProduction(plans: Plan[], res: MonthlyRunResult, clock: Clock): Promise<Promise<void>[]> {
  const work: Promise<void>[] = [];
  let slotsLeft = PRODUCE_PER_TICK;
  for (const plan of plans) {
    if (slotsLeft <= 0 || clock.elapsed() > PRODUCE_START_DEADLINE_MS) break;
    try {
      const claimed = await claimStaticSlots(plan.id, slotsLeft);
      slotsLeft -= claimed.length;
      for (const item of claimed) {
        work.push(
          produceStaticItem(item, plan.userId)
            .then((submitted) => {
              if (submitted) res.produced++;
            })
            .catch((err) => console.error(`[monthly-planning] producing item ${item.id} failed:`, err))
        );
      }
    } catch (err) {
      console.error(`[monthly-planning] plan ${plan.id} production claim failed:`, err);
    }
  }
  return work;
}

/** Atomically move up to `limit` brief-ready static slots to producing (the claim precedes any paid call). */
async function claimStaticSlots(planId: string, limit: number): Promise<PlanItem[]> {
  const claimed = await db.execute(sql`
    UPDATE plan_items SET status = 'producing', error_message = NULL, updated_at = now()
    WHERE id IN (
      SELECT id FROM plan_items
      WHERE plan_id = ${planId} AND status = 'brief_ready' AND asset_type = 'static'
      ORDER BY planned_date ASC, sort_order ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const ids = (claimed as unknown as Array<{ id: string }>).map((r) => r.id);
  if (!ids.length) return [];
  return db.select().from(schema.planItems).where(inArray(schema.planItems.id, ids));
}

/**
 * Move each producing slot forward: schedule completed + QC-cleared ads, park failures,
 * and time out work whose run or Kie job is gone. One slot failing never blocks the rest.
 */
async function advanceProducing(plan: Plan, dryRun: boolean, res: MonthlyRunResult, clock: Clock): Promise<void> {
  if (dryRun) return;

  // Video slots need no generation → terminal 'generated' (the brief is the deliverable).
  const videos = await db
    .update(schema.planItems)
    .set({ status: "generated", updatedAt: new Date() })
    .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.status, "brief_ready"), eq(schema.planItems.assetType, "video")))
    .returning({ id: schema.planItems.id });
  res.videoFinalised += videos.length;

  const rows = await db
    .select({
      item: schema.planItems,
      genStatus: schema.staticAdGenerations.status,
      genCreatedAt: schema.staticAdGenerations.createdAt,
      genImageUrl: schema.staticAdGenerations.imageUrl,
      qcStatus: schema.staticAdGenerations.qcStatus,
    })
    .from(schema.planItems)
    .leftJoin(schema.staticAdGenerations, eq(schema.planItems.generationId, schema.staticAdGenerations.id))
    .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.status, "producing")))
    .orderBy(asc(schema.planItems.plannedDate), asc(schema.planItems.sortOrder));

  const now = Date.now();
  for (const { item, genStatus, genCreatedAt, genImageUrl, qcStatus } of rows) {
    try {
      if (!item.generationId) {
        // Claimed but no ad recorded: the run producing it died (or the ad was deleted).
        if (item.updatedAt.getTime() < now - CLAIM_STALE_MINUTES * 60_000) {
          const failed = await failItem(item.id, "Production was interrupted before the ad was saved — use Retry to produce it again.");
          if (failed) res.stuckFailed++;
        }
        continue;
      }
      if (genStatus && !isDone(genStatus) && genStatus !== "error") {
        if (genCreatedAt && genCreatedAt.getTime() < now - GENERATION_TIMEOUT_MINUTES * 60_000) {
          if (await timeOutLostGeneration(item)) res.stuckFailed++;
        }
        continue;
      }
      // Waiting on the Quality Control verdict is not a timeout — the gate has its own cron.
      if (isDone(genStatus) && qcStatus === "pending") {
        // QC only enqueues ads stored on R2; one whose copy off Kie failed would wait forever.
        if (!onDurableStorage(genImageUrl)) await retryPersist(item.generationId);
        continue;
      }
      // Queueing is the slow part; near the limit, leave it for the next tick.
      if (isDone(genStatus) && !clock.canStart(SCHEDULE_RESERVE_MS)) continue;

      const outcome = await scheduleGeneratedItem(item, plan.userId);
      if (outcome === "scheduled") res.scheduled++;
    } catch (err) {
      console.error(`[monthly-planning] scheduling item ${item.id} failed:`, err);
      try {
        await failItem(item.id, `Scheduling failed: ${err instanceof Error ? err.message : "unknown error"} — use Retry.`);
      } catch (e) {
        console.error(`[monthly-planning] could not record the failure for item ${item.id}:`, e);
      }
    }
  }
}

/** Re-run the lazy persist (copy to R2 + enqueue the QC review) for a completed ad left on a temp URL. */
async function retryPersist(generationId: string): Promise<void> {
  const [gen] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, generationId))
    .limit(1);
  if (gen) await pollAndPersistGeneration(gen);
}

/** Error a slot that is still producing (a concurrent skip or retry wins). Returns true if updated. */
async function failItem(itemId: string, message: string): Promise<boolean> {
  const rows = await db
    .update(schema.planItems)
    .set({ status: "error", errorMessage: message.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(schema.planItems.id, itemId), eq(schema.planItems.status, "producing")))
    .returning({ id: schema.planItems.id });
  return rows.length > 0;
}

/**
 * Give up on a Kie job still 'generating' long after submit — but ask Kie first: the tick's
 * sweep caps each poll at 5 s, so a slow persist or a Kie hiccup must not read as a lost job.
 * Returns true if the slot was errored.
 */
async function timeOutLostGeneration(item: PlanItem): Promise<boolean> {
  const [gen] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, item.generationId!))
    .limit(1);
  if (!gen || gen.status !== "generating") return false;

  if (gen.kieJobId) {
    let polled: Awaited<ReturnType<typeof pollKieJob>>;
    try {
      polled = await pollKieJob(gen.kieJobId);
    } catch {
      return false; // Kie unreachable — decide on a later tick
    }
    if (polled.state === "failed" || (polled.state === "success" && polled.resultUrls.length > 0)) {
      await pollAndPersistGeneration(gen);
      return false; // resolved now; the next pass schedules or fails the slot
    }
  }

  await db
    .update(schema.staticAdGenerations)
    .set({ status: "error", errorMessage: `Kie job unfinished after ${GENERATION_TIMEOUT_MINUTES} minutes — treated as lost`, updatedAt: new Date() })
    .where(and(eq(schema.staticAdGenerations.id, gen.id), eq(schema.staticAdGenerations.status, "generating")));
  return failItem(item.id, `Generation timed out after ${GENERATION_TIMEOUT_MINUTES / 60} hours — use Retry to produce it again.`);
}

/** Every slot settled (nothing brief_ready or producing) → the plan is complete. */
async function rollUp(plan: Plan, dryRun: boolean, res: MonthlyRunResult): Promise<void> {
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(schema.planItems)
    .where(and(eq(schema.planItems.planId, plan.id), inArray(schema.planItems.status, ["brief_ready", "producing"])));
  if (dryRun || open > 0) return;
  const done = await db
    .update(schema.monthlyPlans)
    .set({ status: "complete", updatedAt: new Date() })
    .where(and(eq(schema.monthlyPlans.id, plan.id), eq(schema.monthlyPlans.status, "producing")))
    .returning({ id: schema.monthlyPlans.id });
  res.plansCompleted += done.length;
}
