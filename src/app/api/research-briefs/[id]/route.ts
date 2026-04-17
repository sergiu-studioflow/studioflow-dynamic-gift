import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/research-briefs/:id?clientId=xxx
 * Fetch a single research brief with full data.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId");

  const conditions = [eq(schema.researchBriefs.id, id)];
  if (clientId) conditions.push(eq(schema.researchBriefs.clientId, clientId));

  const [brief] = await db
    .select()
    .from(schema.researchBriefs)
    .where(and(...conditions))
    .limit(1);

  if (!brief) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  return NextResponse.json(brief);
}

/**
 * DELETE /api/research-briefs/:id?clientId=xxx
 * Delete a research brief.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete briefs" }, { status: 403 });
  }

  const { id } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId");

  const conditions = [eq(schema.researchBriefs.id, id)];
  if (clientId) conditions.push(eq(schema.researchBriefs.clientId, clientId));

  const [deleted] = await db
    .delete(schema.researchBriefs)
    .where(and(...conditions))
    .returning({ id: schema.researchBriefs.id });

  if (!deleted) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id: deleted.id });
}
