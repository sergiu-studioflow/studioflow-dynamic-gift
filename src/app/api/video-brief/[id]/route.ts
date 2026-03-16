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
    .from(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, id))
    .limit(1);

  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const briefs = await db
    .select()
    .from(schema.generatedVideoBriefs)
    .where(eq(schema.generatedVideoBriefs.requestId, id))
    .orderBy(asc(schema.generatedVideoBriefs.createdAt));

  return NextResponse.json({ request, briefs });
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
    .from(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // Delete briefs first (no cascade on this FK)
  await db
    .delete(schema.generatedVideoBriefs)
    .where(eq(schema.generatedVideoBriefs.requestId, id));

  await db
    .delete(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, id));

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "video_brief_request_deleted",
    resourceType: "video_brief_request",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
