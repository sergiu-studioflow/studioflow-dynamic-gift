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
    .from(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, id))
    .limit(1);

  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  // Quality Control filter. The default view hides pieces the gate is holding, matching
  // the gallery behaviour — but heldCount is returned so the UI can say how many were
  // filtered rather than silently showing fewer than were generated. ?qc=all|flagged|ready
  // switches views.
  const qc = httpReq.nextUrl.searchParams.get("qc");
  const allIdeas = await db
    .select()
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.requestId, id))
    .orderBy(asc(schema.contentIdeas.sortOrder));

  const heldCount = allIdeas.filter((r) => isHeld(r.qcStatus)).length;
  const ideas =
    qc === "all"
      ? allIdeas
      : qc === "flagged"
        ? allIdeas.filter((r) => isHeld(r.qcStatus))
        : qc === "ready"
          ? allIdeas.filter((r) => isShippable(r.qcStatus))
          : allIdeas.filter((r) => !isHeld(r.qcStatus));

  return NextResponse.json({ request, ideas, heldCount });
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
