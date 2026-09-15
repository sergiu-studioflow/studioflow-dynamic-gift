import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * GET /api/winners/random?clientId=
 * Return a single random winner for shuffle mode. clientId is required: a winner is a
 * brand's own creative, so an unscoped pick would hand one brand another brand's ad.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required — select a client first" }, { status: 400 });
  }

  const [winner] = await db
    .select()
    .from(schema.winnersLibrary)
    .where(and(eq(schema.winnersLibrary.isActive, true), eq(schema.winnersLibrary.clientId, clientId)))
    .orderBy(sql`random()`)
    .limit(1);

  if (!winner) {
    return NextResponse.json({ error: "No winners in library" }, { status: 404 });
  }

  return NextResponse.json({
    ...winner,
    previewUrl: await toAccessibleUrl(winner.imageUrl),
  });
}
