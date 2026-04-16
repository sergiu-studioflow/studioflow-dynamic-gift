import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * GET /api/winners/random
 * Return a single random winner for shuffle mode.
 * Accepts optional ?clientId= to filter by client.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const clientId = req.nextUrl.searchParams.get("clientId");
  const conditions = [eq(schema.winnersLibrary.isActive, true)];
  if (clientId) {
    conditions.push(eq(schema.winnersLibrary.clientId, clientId));
  }

  const [winner] = await db
    .select()
    .from(schema.winnersLibrary)
    .where(and(...conditions))
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
