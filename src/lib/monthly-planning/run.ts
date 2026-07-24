/**
 * Monthly Planning cron stepper. One tick (from /api/cron/monthly-planning-sweep)
 * advances every active plan through its stages, bounded by STEP_CAP + BUDGET_MS
 * so it stays well under maxDuration. Neon quota → run every 15 min.
 *
 * Stages (all gated by user actions that set the plan status):
 *   briefing  → generate briefs for planned items → briefs_ready
 *   producing → brief→static submit (static) / mark generated (video)
 *             → poll generations → schedule completed → complete
 */

import { db, schema } from "@/lib/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getApiKey } from "@/lib/api-keys";
import { sweepGeneratingRows } from "@/lib/static-ads/poll-and-persist";
import { generateBrief } from "./briefs";
import { produceStaticItem } from "./produce";
import { scheduleGeneratedItem } from "./schedule";

const STEP_CAP = 6;
const BUDGET_MS = 240_000;
const STUCK_MINUTES = 25;

export type MonthlyRunResult = {
  briefsGenerated: number;
  produced: number;
  scheduled: number;
  videoFinalised: number;
  plansCompleted: number;
  stuckFailed: number;
  dryRun: boolean;
};

type Plan = typeof schema.monthlyPlans.$inferSelect;

export async function runMonthlyPlanning(opts: { dryRun?: boolean } = {}): Promise<MonthlyRunResult> {
  const dryRun = !!opts.dryRun;
  const res: MonthlyRunResult = { briefsGenerated: 0, produced: 0, scheduled: 0, videoFinalised: 0, plansCompleted: 0, stuckFailed: 0, dryRun };
  const start = Date.now();
  const overBudget = () => Date.now() - start > BUDGET_MS;
  const apiKey = await getApiKey("ANTHROPIC_API_KEY");

  // Always poll in-flight generations first (cheap, advances producing items).
  if (!dryRun) await sweepGeneratingRows({});

  const plans = await db
    .select()
    .from(schema.monthlyPlans)
    .where(inArray(schema.monthlyPlans.status, ["briefing", "producing"]))
    .limit(20);

  for (const plan of plans) {
    if (overBudget()) break;
    try {
      if (plan.status === "briefing") await stepBriefing(plan, apiKey, dryRun, res, overBudget);
      else if (plan.status === "producing") await stepProducing(plan, dryRun, res, overBudget);
    } catch (err) {
      console.error(`[monthly-planning] plan ${plan.id} step failed:`, err);
    }
  }

  return res;
}

async function stepBriefing(plan: Plan, apiKey: string, dryRun: boolean, res: MonthlyRunResult, overBudget: () => boolean) {
  // Claim the next batch of planned items into 'briefing'.
  const planned = await db
    .select()
    .from(schema.planItems)
    .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.status, "planned")))
    .limit(STEP_CAP);

  if (!dryRun) {
    for (const item of planned) {
      if (overBudget()) break;
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
    await db.update(schema.monthlyPlans).set({ status: "briefs_ready", updatedAt: new Date() }).where(eq(schema.monthlyPlans.id, plan.id));
  }
}

async function stepProducing(plan: Plan, dryRun: boolean, res: MonthlyRunResult, overBudget: () => boolean) {
  // 1. Video items that are ready need no generation → terminal 'generated'.
  if (!dryRun) {
    await db
      .update(schema.planItems)
      .set({ status: "generated", updatedAt: new Date() })
      .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.status, "brief_ready"), eq(schema.planItems.assetType, "video")));
  }

  // 2. Static items ready → submit brief→static (bounded).
  const toProduce = await db
    .select()
    .from(schema.planItems)
    .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.status, "brief_ready"), eq(schema.planItems.assetType, "static")))
    .limit(STEP_CAP);
  if (!dryRun) {
    for (const item of toProduce) {
      if (overBudget()) break;
      await produceStaticItem(item, plan.userId);
      res.produced++;
    }
  }

  // 3. Producing items whose generation completed → queue + schedule.
  const producing = await db
    .select()
    .from(schema.planItems)
    .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.status, "producing")))
    .limit(STEP_CAP * 2);
  if (!dryRun) {
    for (const item of producing) {
      if (overBudget()) break;
      const done = await scheduleGeneratedItem(item, plan.userId);
      if (done) res.scheduled++;
    }
  }

  // 4. Stuck static generations (producing too long) → error.
  if (!dryRun) {
    const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000);
    const stuck = await db
      .update(schema.planItems)
      .set({ status: "error", errorMessage: "Generation timed out — retry manually", updatedAt: new Date() })
      .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.status, "producing"), lt(schema.planItems.updatedAt, cutoff)))
      .returning({ id: schema.planItems.id });
    res.stuckFailed += stuck.length;
  }

  // 5. Roll the plan up: all items terminal → complete.
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(schema.planItems)
    .where(and(eq(schema.planItems.planId, plan.id), inArray(schema.planItems.status, ["brief_ready", "producing"])));
  if (!dryRun && open === 0) {
    await db.update(schema.monthlyPlans).set({ status: "complete", updatedAt: new Date() }).where(eq(schema.monthlyPlans.id, plan.id));
    res.plansCompleted++;
  }
}
