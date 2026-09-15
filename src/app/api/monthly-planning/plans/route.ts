import { NextRequest, NextResponse, after } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { desc, sql } from "drizzle-orm";
import { runPlanningInBackground, type PlanInputConfig } from "@/lib/monthly-planning/planner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the after() planning run shares this invocation's budget

/** GET /api/monthly-planning/plans — list plans with item counts. */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const plans = await db.select().from(schema.monthlyPlans).orderBy(desc(schema.monthlyPlans.createdAt)).limit(60);
  if (!plans.length) return NextResponse.json([]);

  const counts = await db
    .select({ planId: schema.planItems.planId, n: sql<number>`count(*)::int` })
    .from(schema.planItems)
    .groupBy(schema.planItems.planId);
  const byPlan = new Map(counts.map((c) => [c.planId, c.n]));

  return NextResponse.json(plans.map((p) => ({ ...p, itemCount: byPlan.get(p.id) ?? 0 })));
}

/**
 * POST /api/monthly-planning/plans
 * Body: { title?, inputConfig: { brands[], month, postsPerBrand, platforms[], staticRatio, themes?, campaigns?, notes? } }
 * Creates the plan in 'planning' and returns at once; planning (one Claude call per brand)
 * runs after the response, and the cron sweep finishes anything that doesn't fit.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = (body.inputConfig || {}) as Partial<PlanInputConfig>;
  const brands = Array.isArray(raw.brands) ? [...new Set(raw.brands.filter((b): b is string => typeof b === "string" && !!b))] : [];
  if (brands.length === 0 || typeof raw.month !== "string" || !/^\d{4}-\d{2}$/.test(raw.month)) {
    return NextResponse.json({ error: "inputConfig needs brands[] and month (YYYY-MM)" }, { status: 400 });
  }
  // Only the form's own fields — the planner keeps its progress in this object too.
  const cfg: PlanInputConfig = {
    brands,
    month: raw.month,
    postsPerBrand: Math.max(1, Math.min(60, Number(raw.postsPerBrand) || 8)),
    platforms: Array.isArray(raw.platforms) && raw.platforms.length ? raw.platforms.map(String) : ["facebook", "instagram"],
    staticRatio: typeof raw.staticRatio === "number" ? Math.max(0, Math.min(1, raw.staticRatio)) : 0.6,
    themes: typeof raw.themes === "string" ? raw.themes : undefined,
    campaigns: typeof raw.campaigns === "string" ? raw.campaigns : undefined,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
  };

  const [plan] = await db
    .insert(schema.monthlyPlans)
    .values({
      month: `${cfg.month}-01`,
      title: typeof body.title === "string" && body.title ? body.title : `${cfg.month} content plan`,
      userId: auth.portalUser.id,
      inputConfig: cfg,
      status: "planning",
    })
    .returning();

  after(() => runPlanningInBackground(plan.id));

  return NextResponse.json({ id: plan.id, status: "planning" }, { status: 202 });
}
