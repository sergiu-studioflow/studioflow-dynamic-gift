import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isShippable, QC_HELD } from "@/lib/qc/gate";

const isHeld = (s?: string | null) => QC_HELD.includes(s ?? "skipped");

export const dynamic = "force-dynamic";

export async function GET(
  httpReq: NextRequest,
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

  // Quality Control filter. The default view hides pieces the gate is holding, matching
  // the gallery behaviour — but heldCount is returned so the UI can say how many were
  // filtered rather than silently showing fewer than were generated. ?qc=all|flagged|ready
  // switches views.
  const qc = httpReq.nextUrl.searchParams.get("qc");
  const allConcepts = await db
    .select()
    .from(schema.generatedAdCopy)
    .where(eq(schema.generatedAdCopy.requestId, id))
    .orderBy(asc(schema.generatedAdCopy.conceptNumber));

  const heldCount = allConcepts.filter((r) => isHeld(r.qcStatus)).length;
  const concepts =
    qc === "all"
      ? allConcepts
      : qc === "flagged"
        ? allConcepts.filter((r) => isHeld(r.qcStatus))
        : qc === "ready"
          ? allConcepts.filter((r) => isShippable(r.qcStatus))
          : allConcepts.filter((r) => !isHeld(r.qcStatus));

  return NextResponse.json({ request, concepts, heldCount });
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
