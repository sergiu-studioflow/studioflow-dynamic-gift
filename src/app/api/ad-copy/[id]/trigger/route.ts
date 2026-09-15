import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { and, eq, gte, inArray, not, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { deleteTextReviewsForRequest } from "@/lib/qc/enqueue";
import { startTextWorkflow, TEXT_WORKFLOW_PATHS } from "@/app/api/webhook/_lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// A run still unfinished after this long is treated as stuck and may be restarted. The copy
// library uses the same threshold to decide when to offer Retry.
const STUCK_AFTER_MS = 20 * 60_000;

/**
 * POST /api/ad-copy/[id]/trigger   body { confirm?: boolean }
 * Re-generate / Retry. Destructive: the request's concepts (and their QC reviews) are deleted
 * and the paid model runs again — so while concepts exist the caller must send confirm:true
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
    .from(schema.adCopyRequests)
    .where(eq(schema.adCopyRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const [{ existingCount }] = await db
    .select({ existingCount: sql<number>`count(*)::int` })
    .from(schema.generatedAdCopy)
    .where(eq(schema.generatedAdCopy.requestId, id));
  if (existingCount > 0 && !confirmed) {
    return NextResponse.json(
      { error: "Re-generating deletes this request's concepts.", code: "confirm_required", existingCount },
      { status: 409 }
    );
  }

  // Restart atomically, and only if no run is in progress: a request still generating (and not
  // yet stuck) is left alone, so a double click or a second tab can't start a duplicate paid run.
  const restarted = await db
    .update(schema.adCopyRequests)
    .set({ status: "new", errorMessage: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.adCopyRequests.id, id),
        not(
          and(
            inArray(schema.adCopyRequests.status, ["new", "processing"]),
            gte(schema.adCopyRequests.updatedAt, new Date(Date.now() - STUCK_AFTER_MS))
          )!
        )
      )
    )
    .returning({ id: schema.adCopyRequests.id });
  if (!restarted.length) {
    return NextResponse.json(
      { error: "This request is still generating. If it hasn't finished after 20 minutes you can retry it.", code: "in_progress" },
      { status: 409 }
    );
  }

  // Reviews first: they are found through the concepts being deleted.
  await deleteTextReviewsForRequest("ad_copy", id);
  await db.delete(schema.generatedAdCopy).where(eq(schema.generatedAdCopy.requestId, id));

  const startError = await startTextWorkflow(TEXT_WORKFLOW_PATHS.adCopy, id);
  if (startError) {
    await db
      .update(schema.adCopyRequests)
      .set({ status: "error", errorMessage: startError, updatedAt: new Date() })
      .where(eq(schema.adCopyRequests.id, id));
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ad_copy_request_retriggered",
    resourceType: "ad_copy_request",
    resourceId: id,
    details: { deletedConcepts: existingCount, started: !startError },
  });

  return NextResponse.json({
    ok: true,
    status: startError ? "error" : "new",
    errorMessage: startError,
  });
}
