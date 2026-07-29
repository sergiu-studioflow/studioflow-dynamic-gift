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
    .from(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, id))
    .limit(1);

  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // Quality Control filter. The default view hides pieces the gate is holding, matching
  // the gallery behaviour — but heldCount is returned so the UI can say how many were
  // filtered rather than silently showing fewer than were generated. ?qc=all|flagged|ready
  // switches views.
  const qc = httpReq.nextUrl.searchParams.get("qc");
  const allBriefs = await db
    .select()
    .from(schema.generatedVideoBriefs)
    .where(eq(schema.generatedVideoBriefs.requestId, id))
    .orderBy(asc(schema.generatedVideoBriefs.createdAt));

  const heldCount = allBriefs.filter((r) => isHeld(r.qcStatus)).length;
  const briefs =
    qc === "all"
      ? allBriefs
      : qc === "flagged"
        ? allBriefs.filter((r) => isHeld(r.qcStatus))
        : qc === "ready"
          ? allBriefs.filter((r) => isShippable(r.qcStatus))
          : allBriefs.filter((r) => !isHeld(r.qcStatus));

  return NextResponse.json({ request, briefs, heldCount });
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
