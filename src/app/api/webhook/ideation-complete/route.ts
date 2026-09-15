import { db, schema } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { enqueueTextBatch } from "@/lib/qc/enqueue";
import { resolveTextClientId } from "@/lib/qc/grade";
import { callbackStatusUpdate, hasValidWebhookSecret, parseCompletionCallback } from "../_lib/text-callback";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/webhook/ideation-complete   x-webhook-secret header, body { requestId, status }
 *
 * The n8n workflow has already saved the ideas and set the request's status; this reads back
 * what it wrote and queues it for Quality Control. Safe to redeliver: only ideas not yet
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
    .select({ brand: schema.ideationRequests.brand, status: schema.ideationRequests.status })
    .from(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, requestId))
    .limit(1);
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // Quality Control gate — one review per idea not yet queued. A run saves up to 30, which is
  // why the text lane has its own larger claim budget and runs concurrently (qc/pipeline.ts).
  const toQueue = await db
    .select({ id: schema.contentIdeas.id, hook: schema.contentIdeas.hook })
    .from(schema.contentIdeas)
    .where(
      and(
        eq(schema.contentIdeas.requestId, requestId),
        isNull(schema.contentIdeas.qcReviewId),
        eq(schema.contentIdeas.qcStatus, "pending")
      )
    );
  await enqueueTextBatch(
    "ideation",
    toQueue.map((row) => ({ id: row.id, copyText: row.hook || null })),
    await resolveTextClientId(req.brand)
  );

  const [{ saved }] = await db
    .select({ saved: sql<number>`count(*)::int` })
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.requestId, requestId));

  const update = callbackStatusUpdate({
    current: req.status,
    inFlightStatuses: ["new", "processing"],
    callback,
    saved,
    noun: "ideas",
  });
  if (update) {
    await db
      .update(schema.ideationRequests)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(schema.ideationRequests.id, requestId));
  }
  const status = update?.status ?? req.status;

  await db.insert(schema.activityLog).values({
    action: status === "error" ? "ideation_error" : "ideation_complete",
    resourceType: "ideation_request",
    resourceId: requestId,
    details: { status, ideaCount: saved, queuedForQc: toQueue.length, ...(callback.errorMessage ? { error: callback.errorMessage } : {}) },
  });

  return NextResponse.json({ ok: true, status, ideaCount: saved, queuedForQc: toQueue.length });
}
