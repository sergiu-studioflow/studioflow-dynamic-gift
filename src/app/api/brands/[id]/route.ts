import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

const updateBrandSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// PUT — update a brand (admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = updateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.format() }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;

  try {
    const [updated] = await db
      .update(schema.brands)
      .set(updates)
      .where(eq(schema.brands.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    await db.insert(schema.activityLog).values({
      userId: auth.portalUser.id,
      action: "brand_updated",
      resourceType: "brand",
      resourceId: updated.id,
      details: { name: updated.name, changes: parsed.data },
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return NextResponse.json({ error: "A brand with this name already exists" }, { status: 409 });
    }
    throw err;
  }
}

// DELETE — remove a brand (admin only)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;

  const [deleted] = await db
    .delete(schema.brands)
    .where(eq(schema.brands.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "brand_deleted",
    resourceType: "brand",
    resourceId: deleted.id,
    details: { name: deleted.name },
  });

  return NextResponse.json({ success: true });
}
