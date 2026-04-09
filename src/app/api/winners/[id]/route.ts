import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteFromR2, r2KeyFromUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/winners/[id]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;

  const [winner] = await db
    .select()
    .from(schema.winnersLibrary)
    .where(eq(schema.winnersLibrary.id, id))
    .limit(1);

  if (!winner) {
    return NextResponse.json({ error: "Winner not found" }, { status: 404 });
  }

  // Delete from R2
  const r2Key = r2KeyFromUrl(winner.imageUrl);
  if (r2Key) {
    try { await deleteFromR2(r2Key); } catch { /* best effort */ }
  }

  await db.delete(schema.winnersLibrary).where(eq(schema.winnersLibrary.id, id));

  return NextResponse.json({ success: true });
}
