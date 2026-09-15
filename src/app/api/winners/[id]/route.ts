import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteFromR2, ownedR2Key } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/winners/[id]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  if (authResult.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete winners" }, { status: 403 });
  }

  const { id } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId");

  const [winner] = await db
    .select()
    .from(schema.winnersLibrary)
    .where(eq(schema.winnersLibrary.id, id))
    .limit(1);

  if (!winner) {
    return NextResponse.json({ error: "Winner not found" }, { status: 404 });
  }

  // IDOR guard: a winner may only be deleted from within its own client.
  if (clientId && winner.clientId && winner.clientId !== clientId) {
    return NextResponse.json({ error: "Winner belongs to a different client" }, { status: 403 });
  }

  // Delete the file only from the winner's own brand folder (shared bucket).
  const r2Key = winner.clientId
    ? ownedR2Key(winner.imageUrl, await getClientStoragePrefix(winner.clientId))
    : null;
  if (r2Key) {
    try { await deleteFromR2(r2Key); } catch { /* best effort */ }
  }

  await db.delete(schema.winnersLibrary).where(eq(schema.winnersLibrary.id, id));

  return NextResponse.json({ success: true });
}
