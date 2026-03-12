import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;

  const [request] = await db
    .select()
    .from(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, id))
    .limit(1);

  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const ideas = await db
    .select()
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.requestId, id))
    .orderBy(asc(schema.contentIdeas.sortOrder));

  return NextResponse.json({ request, ideas });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete" }, { status: 403 });
  }

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  await db
    .delete(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, id));

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ideation_request_deleted",
    resourceType: "ideation_request",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
