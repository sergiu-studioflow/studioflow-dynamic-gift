import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/reference-library/[id]
 * Update name, category, tags, or isActive.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.industry !== undefined) updates.industry = body.industry;
  if (body.adType !== undefined) updates.adType = body.adType;
  if (body.brand !== undefined) updates.brand = body.brand;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  const [updated] = await db
    .update(schema.referenceAdLibrary)
    .set(updates)
    .where(eq(schema.referenceAdLibrary.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

/**
 * DELETE /api/reference-library/[id]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;

  const [deleted] = await db
    .delete(schema.referenceAdLibrary)
    .where(eq(schema.referenceAdLibrary.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
