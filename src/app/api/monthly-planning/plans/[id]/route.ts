import { NextRequest, NextResponse, after } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";
import {
  PLANNING_LEASE_MINUTES,
  reopenPlanning,
  runPlanningInBackground,
  type PlanInputConfig,
} from "@/lib/monthly-planning/planner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // retry_planning runs the planner after the response

/** GET /api/monthly-planning/plans/[id] — plan + items (with brief, generation preview and linked post). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;

  const [plan] = await db.select().from(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, id)).limit(1);
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = await db.select().from(schema.planItems).where(eq(schema.planItems.planId, id)).orderBy(schema.planItems.sortOrder);
  const briefs = items.length
    ? await db.select().from(schema.planBriefs).where(inArray(schema.planBriefs.planItemId, items.map((i) => i.id)))
    : [];
  const briefByItem = new Map(briefs.map((b) => [b.planItemId, b]));

  const brands = await db.select({ id: schema.brands.id, name: schema.brands.brandName }).from(schema.brands);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  const genIds = items.map((i) => i.generationId).filter((x): x is string => !!x);
  const gens = genIds.length
    ? await db
        .select({
          id: schema.staticAdGenerations.id,
          imageUrl: schema.staticAdGenerations.imageUrl,
          status: schema.staticAdGenerations.status,
          qcStatus: schema.staticAdGenerations.qcStatus,
        })
        .from(schema.staticAdGenerations)
        .where(inArray(schema.staticAdGenerations.id, genIds))
    : [];
  const genById = new Map(gens.map((g) => [g.id, g]));

  const postIds = items.map((i) => i.scheduledPostId).filter((x): x is string => !!x);
  const posts = postIds.length
    ? await db
        .select({
          id: schema.scheduledPosts.id,
          status: schema.scheduledPosts.status,
          scheduledAt: schema.scheduledPosts.scheduledAt,
          timezone: schema.scheduledPosts.timezone,
        })
        .from(schema.scheduledPosts)
        .where(inArray(schema.scheduledPosts.id, postIds))
    : [];
  const postById = new Map(posts.map((p) => [p.id, p]));

  const itemsOut = await Promise.all(
    items.map(async (it) => {
      const gen = it.generationId ? genById.get(it.generationId) : null;
      const post = it.scheduledPostId ? postById.get(it.scheduledPostId) : null;
      return {
        ...it,
        brandName: brandName.get(it.clientId) || "",
        brief: briefByItem.get(it.id) || null,
        previewUrl: gen?.imageUrl ? await toAccessibleUrl(gen.imageUrl) : null,
        generationStatus: gen?.status || null,
        qcStatus: gen?.qcStatus || null,
        post: post ? { status: post.status, scheduledAt: post.scheduledAt, timezone: post.timezone } : null,
      };
    })
  );

  return NextResponse.json({ ...plan, items: itemsOut });
}

/** PATCH — advance stage or rename. Body: { action: "approve_plan"|"produce"|"retry_planning"|"rename", title? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const [plan] = await db.select().from(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, id)).limit(1);
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.action === "approve_plan") {
    if (plan.status !== "plan_ready") return NextResponse.json({ error: `Cannot approve a plan in status ${plan.status}` }, { status: 409 });
    await db.update(schema.monthlyPlans).set({ status: "briefing", updatedAt: new Date() }).where(eq(schema.monthlyPlans.id, id));
    return NextResponse.json({ ok: true, status: "briefing" });
  }

  if (body.action === "produce") {
    if (plan.status !== "briefs_ready") return NextResponse.json({ error: `Cannot produce a plan in status ${plan.status}` }, { status: 409 });
    await db.update(schema.monthlyPlans).set({ status: "producing", updatedAt: new Date() }).where(eq(schema.monthlyPlans.id, id));
    return NextResponse.json({ ok: true, status: "producing" });
  }

  // Plan the brands that have no items yet: a failed plan, a plan_ready plan that
  // couldn't plan some brands, or a planning run that went silent.
  if (body.action === "retry_planning") {
    const cfg = plan.inputConfig as PlanInputConfig;
    const hasFailures = Object.keys(cfg.planningErrors || {}).length > 0 || !!plan.errorMessage;
    const stalled = plan.status === "planning" && plan.updatedAt.getTime() < Date.now() - PLANNING_LEASE_MINUTES * 60_000;
    if (!(plan.status === "error" || (plan.status === "plan_ready" && hasFailures) || stalled)) {
      return NextResponse.json({ error: `Nothing to retry for a plan in status ${plan.status}` }, { status: 409 });
    }
    if (!(await reopenPlanning(id, plan.status))) {
      return NextResponse.json({ error: "The plan changed meanwhile — refresh and try again." }, { status: 409 });
    }
    after(() => runPlanningInBackground(id));
    return NextResponse.json({ ok: true, status: "planning" }, { status: 202 });
  }

  if (body.action === "rename" && typeof body.title === "string") {
    await db.update(schema.monthlyPlans).set({ title: body.title, updatedAt: new Date() }).where(eq(schema.monthlyPlans.id, id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** DELETE — remove a plan (cascades items + briefs). Blocked while any of its posts is still set to publish. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;

  // Judge by the linked post, not the item: a post cancelled in the Post Scheduler leaves its item 'scheduled'.
  const live = await db
    .select({ id: schema.planItems.id })
    .from(schema.planItems)
    .innerJoin(schema.scheduledPosts, eq(schema.planItems.scheduledPostId, schema.scheduledPosts.id))
    .where(and(eq(schema.planItems.planId, id), inArray(schema.scheduledPosts.status, ["scheduled", "publishing"])))
    .limit(1);
  if (live.length) {
    return NextResponse.json({ error: "This plan has scheduled posts — unschedule or cancel them in the Post Scheduler first." }, { status: 409 });
  }

  await db.delete(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, id));
  return NextResponse.json({ ok: true });
}
