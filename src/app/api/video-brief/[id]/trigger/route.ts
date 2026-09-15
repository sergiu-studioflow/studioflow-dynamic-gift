import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { and, eq, gte, inArray, not, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { deleteTextReviewsForRequest } from "@/lib/qc/enqueue";
import { startTextWorkflow, TEXT_WORKFLOW_PATHS } from "@/app/api/webhook/_lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// A run still unfinished after this long is treated as stuck and may be restarted. The brief
// library uses the same threshold to decide when to offer Retry.
const STUCK_AFTER_MS = 20 * 60_000;

/**
 * POST /api/video-brief/[id]/trigger   body { confirm?: boolean }
 * Re-generate / Retry. Destructive: the request's briefs (and their QC reviews) are deleted
 * and the paid model runs again — so while briefs exist the caller must send confirm:true
 * (409 confirm_required, with the count, otherwise).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot start generation runs" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const confirmed = body?.confirm === true;

  const [existing] = await db
    .select()
    .from(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const [{ existingCount }] = await db
    .select({ existingCount: sql<number>`count(*)::int` })
    .from(schema.generatedVideoBriefs)
    .where(eq(schema.generatedVideoBriefs.requestId, id));
  if (existingCount > 0 && !confirmed) {
    return NextResponse.json(
      { error: "Re-generating deletes this request's briefs.", code: "confirm_required", existingCount },
      { status: 409 }
    );
  }

  // Portal-created briefs start as 'submitted'; the n8n docs call the same state 'new'.
  // Restart atomically, and only if no run is in progress: a request still generating (and not
  // yet stuck) is left alone, so a double click or a second tab can't start a duplicate paid run.
  const restarted = await db
    .update(schema.videoBriefRequests)
    .set({ status: "submitted", errorMessage: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.videoBriefRequests.id, id),
        not(
          and(
            inArray(schema.videoBriefRequests.status, ["submitted", "new", "processing"]),
            gte(schema.videoBriefRequests.updatedAt, new Date(Date.now() - STUCK_AFTER_MS))
          )!
        )
      )
    )
    .returning({ id: schema.videoBriefRequests.id });
  if (!restarted.length) {
    return NextResponse.json(
      { error: "This request is still generating. If it hasn't finished after 20 minutes you can retry it.", code: "in_progress" },
      { status: 409 }
    );
  }

  // Reviews first: they are found through the briefs being deleted.
  await deleteTextReviewsForRequest("video_brief", id);
  await db.delete(schema.generatedVideoBriefs).where(eq(schema.generatedVideoBriefs.requestId, id));

  const startError = await startTextWorkflow(TEXT_WORKFLOW_PATHS.videoBrief, id);
  if (startError) {
    await db
      .update(schema.videoBriefRequests)
      .set({ status: "error", errorMessage: startError, updatedAt: new Date() })
      .where(eq(schema.videoBriefRequests.id, id));
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "video_brief_request_retriggered",
    resourceType: "video_brief_request",
    resourceId: id,
    details: { deletedBriefs: existingCount, started: !startError },
  });

  return NextResponse.json({
    ok: true,
    status: startError ? "error" : "submitted",
    errorMessage: startError,
  });
}
