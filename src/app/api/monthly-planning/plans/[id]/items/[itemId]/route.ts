import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { generateBrief } from "@/lib/monthly-planning/briefs";
import { QC_HELD } from "@/lib/qc/gate";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // regenerate_brief / retry may run one brief call inline

/** A 'briefing' item this old was left behind by a regenerate call that died. */
const BRIEFING_STALE_MS = 10 * 60_000;

/**
 * PATCH /api/monthly-planning/plans/[id]/items/[itemId]
 * Actions: edit_item | edit_brief | regenerate_brief | retry | skip
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { id: planId, itemId } = await params;
  const body = await req.json().catch(() => ({}));

  const [item] = await db.select().from(schema.planItems).where(eq(schema.planItems.id, itemId)).limit(1);
  if (!item || item.planId !== planId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const locked = ["producing", "generated", "scheduled"].includes(item.status);

  if (body.action === "edit_item") {
    if (locked) return NextResponse.json({ error: "This slot is already in production — edits are locked." }, { status: 409 });
    const upd: Partial<typeof schema.planItems.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.topic === "string") upd.topic = body.topic;
    if (typeof body.direction === "string") upd.direction = body.direction;
    if (typeof body.title === "string") upd.title = body.title;
    if (["feed", "story", "reel"].includes(body.format)) upd.format = body.format;
    if (["static", "video"].includes(body.assetType)) upd.assetType = body.assetType;
    if (typeof body.plannedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.plannedDate)) upd.plannedDate = body.plannedDate;
    if (typeof body.productId === "string" || body.productId === null) upd.productId = body.productId;
    const [row] = await db.update(schema.planItems).set(upd).where(eq(schema.planItems.id, itemId)).returning();
    return NextResponse.json(row);
  }

  if (body.action === "edit_brief") {
    const [brief] = await db.select().from(schema.planBriefs).where(eq(schema.planBriefs.planItemId, itemId)).limit(1);
    if (!brief) return NextResponse.json({ error: "No brief yet" }, { status: 404 });
    if (locked) return NextResponse.json({ error: "This slot is already in production — edits are locked." }, { status: 409 });
    const [row] = await db
      .update(schema.planBriefs)
      .set({ payload: body.payload ?? brief.payload, edited: true, updatedAt: new Date() })
      .where(eq(schema.planBriefs.id, brief.id))
      .returning();
    return NextResponse.json(row);
  }

  if (body.action === "regenerate_brief") {
    if (locked) return NextResponse.json({ error: "This slot is already in production." }, { status: 409 });
    await db.update(schema.planItems).set({ status: "briefing", updatedAt: new Date() }).where(eq(schema.planItems.id, itemId));
    await generateBrief({ ...item, status: "briefing" });
    const [row] = await db.select().from(schema.planItems).where(eq(schema.planItems.id, itemId)).limit(1);
    return NextResponse.json(row);
  }

  // Retry a failed slot at any plan stage. Resumes scheduling when the ad already exists
  // and isn't held; otherwise produces it again from its brief (regenerating a missing
  // brief first). Re-opens a finished plan so the stepper picks the slot back up.
  if (body.action === "retry") {
    const staleBriefing = item.status === "briefing" && item.updatedAt.getTime() < Date.now() - BRIEFING_STALE_MS;
    // A static slot left 'generated' by the old QC release path never got scheduled.
    const strandedStatic = item.status === "generated" && item.assetType === "static" && !!item.generationId;
    if (item.status !== "error" && !staleBriefing && !strandedStatic) {
      return NextResponse.json({ error: "Only failed slots can be retried." }, { status: 409 });
    }
    const [plan] = await db.select().from(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, planId)).limit(1);
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (plan.status === "planning") return NextResponse.json({ error: "The plan is still being planned." }, { status: 409 });

    let nextStatus: "producing" | "brief_ready" | null = null;
    let generationId = item.generationId;
    if (item.assetType === "static" && item.generationId) {
      const [gen] = await db
        .select({ status: schema.staticAdGenerations.status, imageUrl: schema.staticAdGenerations.imageUrl, qcStatus: schema.staticAdGenerations.qcStatus })
        .from(schema.staticAdGenerations)
        .where(eq(schema.staticAdGenerations.id, item.generationId))
        .limit(1);
      const usable = !!gen && (gen.status === "completed" || gen.status === "complete") && !!gen.imageUrl && !QC_HELD.includes(gen.qcStatus);
      if (usable) nextStatus = "producing";
      else generationId = null;
    }

    if (!nextStatus) {
      const [brief] = await db.select({ id: schema.planBriefs.id }).from(schema.planBriefs).where(eq(schema.planBriefs.planItemId, itemId)).limit(1);
      if (!brief) {
        await db.update(schema.planItems).set({ status: "briefing", generationId: null, errorMessage: null, updatedAt: new Date() }).where(eq(schema.planItems.id, itemId));
        await generateBrief({ ...item, status: "briefing", generationId: null });
        const [refreshed] = await db.select().from(schema.planItems).where(eq(schema.planItems.id, itemId)).limit(1);
        if (refreshed?.status !== "brief_ready") {
          return NextResponse.json({ error: refreshed?.errorMessage || "Brief generation failed" }, { status: 502 });
        }
      }
      nextStatus = "brief_ready";
    }

    const [row] = await db
      .update(schema.planItems)
      .set({ status: nextStatus, generationId, errorMessage: null, updatedAt: new Date() })
      .where(eq(schema.planItems.id, itemId))
      .returning();

    if (plan.status === "complete" || plan.status === "scheduled") {
      await db
        .update(schema.monthlyPlans)
        .set({ status: "producing", updatedAt: new Date() })
        .where(and(eq(schema.monthlyPlans.id, planId), eq(schema.monthlyPlans.status, plan.status)));
    }
    return NextResponse.json(row);
  }

  if (body.action === "skip") {
    if (item.status === "scheduled") return NextResponse.json({ error: "Already scheduled." }, { status: 409 });
    await db.update(schema.planItems).set({ status: "skipped", updatedAt: new Date() }).where(eq(schema.planItems.id, itemId));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
