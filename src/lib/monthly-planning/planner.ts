/**
 * Month planner — expands the guided-form input into a distributed month of
 * plan_items, grounded per brand. Dates are computed in code (reliable, honours
 * each brand's posting weekdays); Claude fills the creative content per slot.
 *
 * Planning runs in the background — after() from the create/retry routes, continued by
 * the cron sweep when an invocation runs out of time. One Claude call per brand,
 * PLAN_CONCURRENCY at a time, each brand's items inserted in a single statement.
 * Progress lives on the plan itself (brands with items are done; failures and start
 * counts are kept in input_config), so any run can pick up where another stopped.
 */

import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { callClaude } from "@/lib/static-ads/anthropic";
import { getApiKey } from "@/lib/api-keys";
import { CORE_ANGLES } from "@/lib/posting/captions";
import { loadBrandContext, staticIneligibleReason, type BrandContext } from "./context";

export type PlanInputConfig = {
  brands: string[]; // clientIds
  month: string; // "YYYY-MM"
  postsPerBrand: number;
  platforms: string[]; // ["facebook","instagram"]
  staticRatio: number; // 0..1 fraction of slots that should be static (rest video)
  themes?: string;
  campaigns?: string;
  notes?: string;
  /** Written by the planner: clientId → why that brand could not be planned. */
  planningErrors?: Record<string, string>;
  /** Written by the planner: clientId → planning runs started for that brand. */
  planningAttempts?: Record<string, number>;
};

type Plan = typeof schema.monthlyPlans.$inferSelect;

type SlotSpec = {
  assetType: "static" | "video";
  format: "feed" | "story" | "reel";
  angleTag: string;
  topic: string;
  title: string;
  direction: string;
  productName: string | null;
};

const PLAN_CONCURRENCY = 3;
/** A brand whose planning run was cut off this many times is given up on. */
const MAX_BRAND_ATTEMPTS = 3;
const PLAN_THINKING_TOKENS = 3000;
/** Background runs heartbeat the plan; one silent for longer than this is presumed dead. */
export const PLANNING_LEASE_MINUTES = 8;
/** Plans left 'planning' by the old inline planner are errored for a Retry, not resumed unasked. */
const LEGACY_GIVE_UP_HOURS = 24;
/** One background invocation's budget (the routes' maxDuration is 300 s). */
const PLANNING_RUN_LIMIT_MS = 280_000;

const postsPerBrand = (cfg: PlanInputConfig) => Math.max(1, Math.min(60, Number(cfg.postsPerBrand) || 8));

/** ~110 output tokens per slot object plus headroom; thinking counts toward max_tokens. */
const planMaxTokens = (count: number) => PLAN_THINKING_TOKENS + 1000 + count * 160;

/** Wall time to keep free before starting a brand (generation + callClaude's retry backoff). */
const brandReserveMs = (count: number) => 75_000 + count * 2_500;

/** A deadline check for one invocation: can work needing `reserveMs` still start? */
export function planningClock(limitMs = PLANNING_RUN_LIMIT_MS): (reserveMs: number) => boolean {
  const started = Date.now();
  return (reserveMs) => Date.now() - started + reserveMs < limitMs;
}

/** Evenly spread `count` dates across the month's allowed weekdays (repeats if count exceeds days). */
export function spreadDates(year: number, monthIdx0: number, count: number, allowedWeekdays: number[]): string[] {
  const days: string[] = [];
  const d = new Date(Date.UTC(year, monthIdx0, 1));
  while (d.getUTCMonth() === monthIdx0) {
    if (allowedWeekdays.includes(d.getUTCDay())) {
      days.push(`${year}-${String(monthIdx0 + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  if (days.length === 0 || count <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.min(days.length - 1, Math.round((i * (days.length - 1)) / Math.max(1, count - 1)));
    out.push(days[idx]);
  }
  return out;
}

/** Brand-neutral template: each brand plans in its own identity (no parent-company voice). */
function plannerSystemPrompt(brandName: string): string {
  return `You are a senior social content strategist for ${brandName}, an Australian promotional products company (B2B). You plan a month of ORGANIC social content for this brand.

Brand grounding: plan for ${brandName} only. Every fact, capability, service promise or claim in a topic or direction must come from ${brandName}'s own USPs and brand context in the user message. ${brandName} has sister brands — never borrow their names, facts, claims or positioning; if it is not in ${brandName}'s own context, leave it out. Angles are themes, not facts: only assert what an angle implies where ${brandName}'s context supports it.

Output ONLY a valid JSON array (no markdown, no prose). Australian English. Do NOT invent products — for static slots you MUST pick a productName from the provided list (exact match) or set it null; for video slots productName may be null.

Each array element:
{
  "assetType": "static" | "video",
  "format": "feed" | "story" | "reel",
  "angleTag": one of the provided angle tags,
  "topic": short topic/theme for this post,
  "title": a short internal label,
  "direction": 1-2 sentences of creative direction (what the post shows/says),
  "productName": exact product name from the list, or null
}`;
}

function buildUserMessage(ctx: BrandContext, count: number, cfg: PlanInputConfig, staticBlocker: string | null): string {
  const productList = ctx.staticEligibleProducts.map((p) => `- ${p.name}${p.isHero ? " (hero)" : ""}`).join("\n") || "(no products with images)";
  const angles = CORE_ANGLES.map((a) => `${a.tag} = ${a.label}`).join("; ");
  const staticShare = staticBlocker ? 0 : Math.round(cfg.staticRatio * 100);
  return `Brand: ${ctx.brandName}
Plan ${count} posts for this month.
Static/video mix: aim for ~${staticShare}% static, the rest video briefs.${staticBlocker ? ` NOTE: this brand cannot produce static ads right now (${staticBlocker}) — make ALL slots video.` : ""}

Angles to rotate through: ${angles}
Platforms: ${cfg.platforms.join(", ")}
${cfg.themes ? `Monthly themes: ${cfg.themes}` : ""}
${cfg.campaigns ? `Campaigns/priorities: ${cfg.campaigns}` : ""}
${cfg.notes ? `Notes: ${cfg.notes}` : ""}

Products available for static slots (pick exact names):
${productList}

Brand USPs: ${ctx.usps.slice(0, 8).join(" | ") || "(none)"}

Brand context (voice/positioning):
${ctx.brandIntel.slice(0, 3500)}

Return exactly ${count} JSON array elements.`;
}

function parseSlots(text: string): SlotSpec[] {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned.startsWith("[")) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) cleaned = m[0];
  }
  const arr = JSON.parse(cleaned);
  if (!Array.isArray(arr)) throw new Error("Planner did not return an array");
  return arr.map((s: Record<string, unknown>) => ({
    assetType: s.assetType === "static" ? "static" : "video",
    format: ["feed", "story", "reel"].includes(String(s.format)) ? (s.format as SlotSpec["format"]) : "feed",
    angleTag: String(s.angleTag || "proof"),
    topic: String(s.topic || "").slice(0, 300),
    title: String(s.title || "Post").slice(0, 120),
    direction: String(s.direction || "").slice(0, 800),
    productName: s.productName ? String(s.productName) : null,
  }));
}

/** Plan one brand: one Claude call, then all of its items in a single insert. Returns items inserted. */
async function planBrand(plan: Plan, cfg: PlanInputConfig, clientId: string, apiKey: string): Promise<number> {
  const [yearStr, monthStr] = cfg.month.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx0 = parseInt(monthStr, 10) - 1;

  const ctx = await loadBrandContext(clientId);
  const staticBlocker = staticIneligibleReason(ctx);
  const canStatic = !staticBlocker;
  const dates = spreadDates(year, monthIdx0, postsPerBrand(cfg), ctx.prefs.daysOfWeek);
  if (dates.length === 0) throw new Error("no posting days for this brand in that month");

  const { text } = await callClaude({
    system: plannerSystemPrompt(ctx.brandName),
    messages: [{ role: "user", content: buildUserMessage(ctx, dates.length, cfg, staticBlocker) }],
    // Scaled with the slot count: a truncated array fails to parse and drops the brand.
    maxTokens: planMaxTokens(dates.length),
    budgetTokens: PLAN_THINKING_TOKENS,
    apiKey,
  });
  let slots = parseSlots(text);
  // Pad/truncate to match dates.
  if (slots.length < dates.length) {
    const angles = CORE_ANGLES;
    for (let i = slots.length; i < dates.length; i++) {
      slots.push({ assetType: canStatic ? "static" : "video", format: "feed", angleTag: angles[i % angles.length].tag, topic: cfg.themes || "Brand post", title: "Post", direction: "", productName: null });
    }
  }
  slots = slots.slice(0, dates.length);

  const productByName = new Map(ctx.staticEligibleProducts.map((p) => [p.name.toLowerCase(), p]));
  const heroFallback = ctx.staticEligibleProducts.find((p) => p.isHero) || ctx.staticEligibleProducts[0];
  // Brands finish in any order; keep items in the form's brand order.
  const sortBase = Math.max(0, cfg.brands.indexOf(clientId)) * 1000;

  const rows = slots.map((s, i) => {
    // Enforce eligibility: static requires a resolvable product.
    let assetType = s.assetType;
    let productId: string | null = null;
    if (assetType === "static") {
      if (!canStatic) {
        assetType = "video";
      } else {
        const prod = (s.productName && productByName.get(s.productName.toLowerCase())) || heroFallback;
        if (prod) productId = prod.id;
        else assetType = "video";
      }
    }
    const format = assetType === "video" ? (s.format === "feed" ? "reel" : s.format) : s.format;
    return {
      planId: plan.id,
      clientId,
      plannedDate: dates[i],
      assetType,
      format,
      platforms: cfg.platforms,
      angleTag: s.angleTag,
      topic: s.topic,
      productId,
      title: s.title,
      direction: s.direction,
      status: "planned",
      sortOrder: sortBase + i,
    };
  });

  return db.transaction(async (tx) => {
    // Serialise on the plan row: an overlapping run may have planned this brand meanwhile.
    await tx.execute(sql`SELECT id FROM monthly_plans WHERE id = ${plan.id} FOR UPDATE`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.planItems)
      .where(and(eq(schema.planItems.planId, plan.id), eq(schema.planItems.clientId, clientId)));
    if (n > 0) return 0;
    await tx.insert(schema.planItems).values(rows);
    return rows.length;
  });
}

/** Count a planning start for this brand; also heartbeats the plan's lease. */
async function recordBrandStart(planId: string, clientId: string): Promise<void> {
  const cfgCol = schema.monthlyPlans.inputConfig;
  await db
    .update(schema.monthlyPlans)
    .set({
      inputConfig: sql`jsonb_set(${cfgCol}, '{planningAttempts}', coalesce(${cfgCol} -> 'planningAttempts', '{}'::jsonb) || jsonb_build_object(${clientId}::text, coalesce((${cfgCol} -> 'planningAttempts' ->> ${clientId}::text)::int, 0) + 1))`,
      updatedAt: new Date(),
    })
    .where(eq(schema.monthlyPlans.id, planId));
}

async function recordBrandFailure(planId: string, clientId: string, reason: string): Promise<void> {
  const cfgCol = schema.monthlyPlans.inputConfig;
  await db
    .update(schema.monthlyPlans)
    .set({
      inputConfig: sql`jsonb_set(${cfgCol}, '{planningErrors}', coalesce(${cfgCol} -> 'planningErrors', '{}'::jsonb) || jsonb_build_object(${clientId}::text, ${reason.slice(0, 300)}::text))`,
      updatedAt: new Date(),
    })
    .where(eq(schema.monthlyPlans.id, planId));
}

/** Brands that already have items, and brands still to plan (no items, no failure, attempts left). */
async function planningProgress(plan: Plan): Promise<{ planned: Set<string>; pending: string[] }> {
  const cfg = plan.inputConfig as PlanInputConfig;
  const rows = await db
    .selectDistinct({ clientId: schema.planItems.clientId })
    .from(schema.planItems)
    .where(eq(schema.planItems.planId, plan.id));
  const planned = new Set(rows.map((r) => r.clientId));
  const failed = cfg.planningErrors || {};
  const attempts = cfg.planningAttempts || {};
  const pending = [...new Set(cfg.brands || [])].filter(
    (id) => !planned.has(id) && !failed[id] && (attempts[id] ?? 0) < MAX_BRAND_ATTEMPTS
  );
  return { planned, pending };
}

/** Settle a plan once every brand is planned or given up on. Returns true if it is settled. */
async function finaliseIfPlanned(planId: string): Promise<boolean> {
  const [plan] = await db.select().from(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, planId)).limit(1);
  if (!plan || plan.status !== "planning") return true;
  const { planned, pending } = await planningProgress(plan);
  if (pending.length) return false;

  const cfg = plan.inputConfig as PlanInputConfig;
  const unplanned = [...new Set(cfg.brands || [])].filter((id) => !planned.has(id));
  let note: string | null = null;
  if (unplanned.length) {
    const names = await db
      .select({ id: schema.brands.id, name: schema.brands.brandName })
      .from(schema.brands)
      .where(inArray(schema.brands.id, unplanned));
    const nameById = new Map(names.map((b) => [b.id, b.name]));
    note = `Couldn't plan ${unplanned.length} brand${unplanned.length > 1 ? "s" : ""}: ${unplanned
      .map((id) => `${nameById.get(id) || "unknown brand"} (${cfg.planningErrors?.[id] || "planning timed out"})`)
      .join("; ")}`.slice(0, 1000);
  }

  await db
    .update(schema.monthlyPlans)
    .set({
      status: planned.size > 0 ? "plan_ready" : "error",
      errorMessage: note ?? (planned.size > 0 ? null : "No plan items could be generated"),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.monthlyPlans.id, planId), eq(schema.monthlyPlans.status, "planning")));
  return true;
}

/**
 * Plan every brand of a 'planning' plan that isn't planned yet. A brand only starts while
 * `canStart` leaves room for it, so the caller's maxDuration is never hit mid-brand; the
 * plan settles to plan_ready/error once every brand is accounted for, otherwise it stays
 * 'planning' for the cron sweep to continue.
 */
export async function continueMonthPlan(
  planId: string,
  canStart: (reserveMs: number) => boolean
): Promise<{ items: number; finished: boolean }> {
  const [plan] = await db.select().from(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, planId)).limit(1);
  if (!plan || plan.status !== "planning") return { items: 0, finished: true };
  const cfg = plan.inputConfig as PlanInputConfig;

  const { pending } = await planningProgress(plan);
  const reserve = brandReserveMs(postsPerBrand(cfg));
  let items = 0;

  if (pending.length && canStart(reserve)) {
    const apiKey = await getApiKey("ANTHROPIC_API_KEY");
    const queue = [...pending];
    const worker = async () => {
      while (queue.length && canStart(reserve)) {
        const clientId = queue.shift()!;
        await recordBrandStart(planId, clientId);
        try {
          const inserted = await planBrand(plan, cfg, clientId, apiKey);
          items += inserted;
        } catch (err) {
          console.error(`[monthly-planning/planner] brand ${clientId} failed:`, err);
          await recordBrandFailure(planId, clientId, err instanceof Error ? err.message : "Planning failed");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PLAN_CONCURRENCY, queue.length) }, worker));
  }

  return { items, finished: await finaliseIfPlanned(planId) };
}

/** after() entry point: plan what fits in this invocation; the sweep continues the rest. */
export async function runPlanningInBackground(planId: string): Promise<void> {
  try {
    await continueMonthPlan(planId, planningClock());
  } catch (err) {
    console.error(`[monthly-planning/planner] background planning for ${planId} failed:`, err);
  }
}

/**
 * Put a plan back into 'planning' for another pass over the brands that have no items
 * (failures and attempt counts are cleared; planned brands keep their items).
 * Returns false if the plan changed status meanwhile.
 */
export async function reopenPlanning(planId: string, fromStatus: string): Promise<boolean> {
  const cfgCol = schema.monthlyPlans.inputConfig;
  const rows = await db
    .update(schema.monthlyPlans)
    .set({
      status: "planning",
      errorMessage: null,
      inputConfig: sql`(${cfgCol} - 'planningErrors') - 'planningAttempts'`,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.monthlyPlans.id, planId), eq(schema.monthlyPlans.status, fromStatus)))
    .returning({ id: schema.monthlyPlans.id });
  return rows.length > 0;
}

/**
 * Cron side of background planning: continue plans whose planner stopped (lease expired —
 * the invocation ran out of time or died). Returns the number of plans advanced.
 */
export async function sweepStalePlanning(canStart: (reserveMs: number) => boolean): Promise<number> {
  const cutoff = new Date(Date.now() - PLANNING_LEASE_MINUTES * 60_000);
  const stale = await db
    .select()
    .from(schema.monthlyPlans)
    .where(and(eq(schema.monthlyPlans.status, "planning"), lt(schema.monthlyPlans.updatedAt, cutoff)))
    .orderBy(asc(schema.monthlyPlans.createdAt))
    .limit(5);

  let advanced = 0;
  for (const plan of stale) {
    const cfg = plan.inputConfig as PlanInputConfig;
    const stillPlanningStale = and(
      eq(schema.monthlyPlans.id, plan.id),
      eq(schema.monthlyPlans.status, "planning"),
      lt(schema.monthlyPlans.updatedAt, cutoff)
    );

    if (!cfg.planningAttempts && plan.createdAt.getTime() < Date.now() - LEGACY_GIVE_UP_HOURS * 3600_000) {
      await db
        .update(schema.monthlyPlans)
        .set({ status: "error", errorMessage: "Planning didn't finish — use Retry to plan it again.", updatedAt: new Date() })
        .where(stillPlanningStale);
      continue;
    }

    if (!canStart(brandReserveMs(postsPerBrand(cfg)))) break;
    // Take the lease atomically so a live background run and this sweep never overlap.
    const claimed = await db
      .update(schema.monthlyPlans)
      .set({ updatedAt: new Date() })
      .where(stillPlanningStale)
      .returning({ id: schema.monthlyPlans.id });
    if (!claimed.length) continue;

    await continueMonthPlan(plan.id, canStart);
    advanced++;
  }
  return advanced;
}
