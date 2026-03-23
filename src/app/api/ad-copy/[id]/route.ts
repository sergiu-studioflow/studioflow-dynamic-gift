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
    .from(schema.adCopyRequests)
    .where(eq(schema.adCopyRequests.id, id))
    .limit(1);

  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const concepts = await db
    .select()
    .from(schema.generatedAdCopy)
    .where(eq(schema.generatedAdCopy.requestId, id))
    .orderBy(asc(schema.generatedAdCopy.conceptNumber));

  return NextResponse.json({ request, concepts });
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
    .from(schema.adCopyRequests)
    .where(eq(schema.adCopyRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // CASCADE handles generated_ad_copy deletion
  await db
    .delete(schema.adCopyRequests)
    .where(eq(schema.adCopyRequests.id, id));

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ad_copy_request_deleted",
    resourceType: "ad_copy_request",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
