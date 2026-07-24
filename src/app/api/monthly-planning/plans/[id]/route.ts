import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/monthly-planning/plans/[id] — plan + items (with brief + generation preview). */
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
    ? await db.select({ id: schema.staticAdGenerations.id, imageUrl: schema.staticAdGenerations.imageUrl, status: schema.staticAdGenerations.status }).from(schema.staticAdGenerations).where(inArray(schema.staticAdGenerations.id, genIds))
    : [];
  const genById = new Map(gens.map((g) => [g.id, g]));

  const itemsOut = await Promise.all(
    items.map(async (it) => {
      const gen = it.generationId ? genById.get(it.generationId) : null;
      return {
        ...it,
        brandName: brandName.get(it.clientId) || "",
        brief: briefByItem.get(it.id) || null,
        previewUrl: gen?.imageUrl ? await toAccessibleUrl(gen.imageUrl) : null,
        generationStatus: gen?.status || null,
      };
    })
  );

  return NextResponse.json({ ...plan, items: itemsOut });
}

/** PATCH — advance stage or rename. Body: { action: "approve_plan"|"produce"|"rename", title? } */
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

  if (body.action === "rename" && typeof body.title === "string") {
    await db.update(schema.monthlyPlans).set({ title: body.title, updatedAt: new Date() }).where(eq(schema.monthlyPlans.id, id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** DELETE — remove a plan (cascades items + briefs). Blocked once anything is scheduled. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id } = await params;

  const scheduled = await db
    .select({ id: schema.planItems.id })
    .from(schema.planItems)
    .where(and(eq(schema.planItems.planId, id), eq(schema.planItems.status, "scheduled")))
    .limit(1);
  if (scheduled.length) {
    return NextResponse.json({ error: "This plan has scheduled posts — cancel them in the Post Scheduler first." }, { status: 409 });
  }

  await db.delete(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, id));
  return NextResponse.json({ ok: true });
}
