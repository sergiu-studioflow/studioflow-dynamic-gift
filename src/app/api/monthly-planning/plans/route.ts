import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { desc, eq, sql } from "drizzle-orm";
import { generateMonthPlan, type PlanInputConfig } from "@/lib/monthly-planning/planner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // planner = one Claude call per brand

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
 * Creates the plan and expands it (inline) into plan_items → plan_ready.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const cfg = body.inputConfig as PlanInputConfig;
  if (!cfg || !Array.isArray(cfg.brands) || cfg.brands.length === 0 || !cfg.month || !/^\d{4}-\d{2}$/.test(cfg.month)) {
    return NextResponse.json({ error: "inputConfig needs brands[] and month (YYYY-MM)" }, { status: 400 });
  }
  cfg.postsPerBrand = Math.max(1, Math.min(60, Number(cfg.postsPerBrand) || 8));
  cfg.platforms = Array.isArray(cfg.platforms) && cfg.platforms.length ? cfg.platforms : ["facebook", "instagram"];
  cfg.staticRatio = typeof cfg.staticRatio === "number" ? Math.max(0, Math.min(1, cfg.staticRatio)) : 0.6;

  const [plan] = await db
    .insert(schema.monthlyPlans)
    .values({
      month: `${cfg.month}-01`,
      title: body.title || `${cfg.month} content plan`,
      userId: auth.portalUser.id,
      inputConfig: cfg,
      status: "planning",
    })
    .returning();

  try {
    const { items } = await generateMonthPlan(plan.id);
    return NextResponse.json({ id: plan.id, status: items > 0 ? "plan_ready" : "error", items }, { status: 201 });
  } catch (err) {
    await db
      .update(schema.monthlyPlans)
      .set({ status: "error", errorMessage: err instanceof Error ? err.message : "Planning failed", updatedAt: new Date() })
      .where(eq(schema.monthlyPlans.id, plan.id));
    return NextResponse.json({ error: err instanceof Error ? err.message : "Planning failed", id: plan.id }, { status: 500 });
  }
}
