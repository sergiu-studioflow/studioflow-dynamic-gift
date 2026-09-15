import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/review-graphics/[id]
 * Body (one of):
 *   { action: "approve" | "reject" }
 *   { captions: { pullQuote?, instagramCaption?, storiesCaption?, facebookCaption?, cta?, hashtags? } }
 *
 * The human approval gate. Editing captions is allowed in any non-terminal
 * state and keeps the row a draft. Approve/Reject set the terminal state.
 * Approve is refused (409) while images are still generating or when none
 * finished — posting needs a completed image.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  if (authResult.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const [existing] = await db
    .select({ id: schema.reviewGraphics.id, status: schema.reviewGraphics.status })
    .from(schema.reviewGraphics)
    .where(eq(schema.reviewGraphics.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: Partial<typeof schema.reviewGraphics.$inferInsert> = { updatedAt: new Date() };

  if (body.action === "approve") {
    const assets = await db
      .select({ status: schema.reviewGraphicAssets.status })
      .from(schema.reviewGraphicAssets)
      .where(eq(schema.reviewGraphicAssets.graphicId, id));
    if (existing.status === "generating" || assets.some((a) => a.status === "generating")) {
      return NextResponse.json(
        { error: "This graphic is still generating — approve it once the images have finished." },
        { status: 409 }
      );
    }
    if (existing.status === "error" || !assets.some((a) => a.status === "completed")) {
      return NextResponse.json(
        { error: "This graphic has no finished images, so it can't be approved. Reject it, or generate it again from the Reviews tab." },
        { status: 409 }
      );
    }
    update.status = "approved";
    update.approvedBy = authResult.portalUser.id;
    update.approvedAt = new Date();
  } else if (body.action === "reject") {
    update.status = "rejected";
    update.approvedBy = authResult.portalUser.id;
    update.approvedAt = new Date();
  } else if (body.captions && typeof body.captions === "object") {
    const c = body.captions;
    if (typeof c.pullQuote === "string") update.pullQuote = c.pullQuote;
    if (typeof c.instagramCaption === "string") update.instagramCaption = c.instagramCaption;
    if (typeof c.storiesCaption === "string") update.storiesCaption = c.storiesCaption;
    if (typeof c.facebookCaption === "string") update.facebookCaption = c.facebookCaption;
    if (typeof c.cta === "string") update.cta = c.cta;
    if (Array.isArray(c.hashtags)) {
      update.hashtags = c.hashtags.map((h: unknown) => String(h).replace(/^#/, "").trim()).filter(Boolean);
    }
  } else {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.reviewGraphics)
    .set(update)
    .where(eq(schema.reviewGraphics.id, id))
    .returning();

  await db.insert(schema.activityLog).values({
    userId: authResult.portalUser.id,
    clientId: updated.clientId,
    action: body.action ? `review_graphic_${body.action}` : "review_graphic_edited",
    resourceType: "review_graphic",
    resourceId: updated.id,
    details: { status: updated.status },
  });

  return NextResponse.json(updated);
}
