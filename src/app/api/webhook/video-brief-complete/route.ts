import { db, schema } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { enqueueTextBatch } from "@/lib/qc/enqueue";
import { resolveTextClientId } from "@/lib/qc/grade";
import { callbackStatusUpdate, hasValidWebhookSecret, parseCompletionCallback } from "../_lib/text-callback";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/webhook/video-brief-complete   x-webhook-secret header, body { requestId, status }
 *
 * The n8n workflow has already saved the briefs and set the request's status; this reads back
 * what it wrote and queues it for Quality Control. Safe to redeliver: only briefs not yet
 * queued are enqueued, and nothing is inserted here.
 */
export async function POST(request: NextRequest) {
  if (!hasValidWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const callback = await parseCompletionCallback(request);
  if ("error" in callback) return NextResponse.json({ error: callback.error }, { status: 400 });
  const { requestId } = callback;

  const [req] = await db
    .select({ brand: schema.videoBriefRequests.brand, status: schema.videoBriefRequests.status })
    .from(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, requestId))
    .limit(1);
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // Quality Control gate — one review per brief not yet queued (a redelivered callback must
  // not re-queue settled work).
  const toQueue = await db
    .select({
      id: schema.generatedVideoBriefs.id,
      briefTitle: schema.generatedVideoBriefs.briefTitle,
      primaryHook: schema.generatedVideoBriefs.primaryHook,
    })
    .from(schema.generatedVideoBriefs)
    .where(
      and(
        eq(schema.generatedVideoBriefs.requestId, requestId),
        isNull(schema.generatedVideoBriefs.qcReviewId),
        eq(schema.generatedVideoBriefs.qcStatus, "pending")
      )
    );
  await enqueueTextBatch(
    "video_brief",
    toQueue.map((b) => ({
      id: b.id,
      copyText: [b.briefTitle, b.primaryHook].filter(Boolean).join(" · ") || null,
    })),
    await resolveTextClientId(req.brand)
  );

  const [{ saved }] = await db
    .select({ saved: sql<number>`count(*)::int` })
    .from(schema.generatedVideoBriefs)
    .where(eq(schema.generatedVideoBriefs.requestId, requestId));

  const update = callbackStatusUpdate({
    current: req.status,
    // Portal-created briefs start as 'submitted'; the n8n docs call the same state 'new'.
    inFlightStatuses: ["submitted", "new", "processing"],
    callback,
    saved,
    noun: "briefs",
  });
  if (update) {
    await db
      .update(schema.videoBriefRequests)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(schema.videoBriefRequests.id, requestId));
  }
  const status = update?.status ?? req.status;

  await db.insert(schema.activityLog).values({
    action: status === "error" ? "video_brief_error" : "video_brief_complete",
    resourceType: "video_brief_request",
    resourceId: requestId,
    details: { status, briefCount: saved, queuedForQc: toQueue.length, ...(callback.errorMessage ? { error: callback.errorMessage } : {}) },
  });

  return NextResponse.json({ ok: true, status, briefCount: saved, queuedForQc: toQueue.length });
}
