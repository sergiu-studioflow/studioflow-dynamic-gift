import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { generateBrief } from "@/lib/monthly-planning/briefs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PATCH /api/monthly-planning/plans/[id]/items/[itemId]
 * Actions: edit_item | edit_brief | regenerate_brief | skip
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const { itemId } = await params;
  const body = await req.json().catch(() => ({}));

  const [item] = await db.select().from(schema.planItems).where(eq(schema.planItems.id, itemId)).limit(1);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  if (body.action === "skip") {
    if (item.status === "scheduled") return NextResponse.json({ error: "Already scheduled." }, { status: 409 });
    await db.update(schema.planItems).set({ status: "skipped", updatedAt: new Date() }).where(eq(schema.planItems.id, itemId));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
