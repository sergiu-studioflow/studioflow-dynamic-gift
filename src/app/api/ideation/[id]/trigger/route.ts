import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { and, eq, gte, inArray, not, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { deleteTextReviewsForRequest } from "@/lib/qc/enqueue";
import { startTextWorkflow, TEXT_WORKFLOW_PATHS } from "@/app/api/webhook/_lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// A run still unfinished after this long is treated as stuck and may be restarted. The idea
// library uses the same threshold to decide when to offer Retry.
const STUCK_AFTER_MS = 20 * 60_000;

/**
 * POST /api/ideation/[id]/trigger   body { confirm?: boolean }
 * Re-generate / Retry. Destructive: the request's ideas (and their QC reviews) are deleted and
 * the paid model runs again — so while ideas exist the caller must send confirm:true (409
 * confirm_required, with the count, otherwise).
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
    .from(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const [{ existingCount }] = await db
    .select({ existingCount: sql<number>`count(*)::int` })
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.requestId, id));
  if (existingCount > 0 && !confirmed) {
    return NextResponse.json(
      { error: "Re-generating deletes this request's ideas.", code: "confirm_required", existingCount },
      { status: 409 }
    );
  }

  // Restart atomically, and only if no run is in progress: a request still generating (and not
  // yet stuck) is left alone, so a double click or a second tab can't start a duplicate paid run.
  const restarted = await db
    .update(schema.ideationRequests)
    .set({ status: "new", errorMessage: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.ideationRequests.id, id),
        not(
          and(
            inArray(schema.ideationRequests.status, ["new", "processing"]),
            gte(schema.ideationRequests.updatedAt, new Date(Date.now() - STUCK_AFTER_MS))
          )!
        )
      )
    )
    .returning({ id: schema.ideationRequests.id });
  if (!restarted.length) {
    return NextResponse.json(
      { error: "This request is still generating. If it hasn't finished after 20 minutes you can retry it.", code: "in_progress" },
      { status: 409 }
    );
  }

  // Reviews first: they are found through the ideas being deleted.
  await deleteTextReviewsForRequest("ideation", id);
  await db.delete(schema.contentIdeas).where(eq(schema.contentIdeas.requestId, id));

  const startError = await startTextWorkflow(TEXT_WORKFLOW_PATHS.ideation, id);
  if (startError) {
    await db
      .update(schema.ideationRequests)
      .set({ status: "error", errorMessage: startError, updatedAt: new Date() })
      .where(eq(schema.ideationRequests.id, id));
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ideation_request_retriggered",
    resourceType: "ideation_request",
    resourceId: id,
    details: { deletedIdeas: existingCount, started: !startError },
  });

  return NextResponse.json({
    ok: true,
    status: startError ? "error" : "new",
    errorMessage: startError,
  });
}
