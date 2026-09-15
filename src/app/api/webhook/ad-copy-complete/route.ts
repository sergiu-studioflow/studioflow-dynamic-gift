import { db, schema } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { enqueueTextBatch } from "@/lib/qc/enqueue";
import { renderValue, resolveTextClientId } from "@/lib/qc/grade";
import { callbackStatusUpdate, hasValidWebhookSecret, parseCompletionCallback } from "../_lib/text-callback";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/webhook/ad-copy-complete   x-webhook-secret header, body { requestId, status }
 *
 * The n8n workflow has already saved the concepts and set the request's status; this reads
 * back what it wrote and queues it for Quality Control. Safe to redeliver: only concepts not
 * yet queued are enqueued, and nothing is inserted here.
 */
export async function POST(request: NextRequest) {
  if (!hasValidWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const callback = await parseCompletionCallback(request);
  if ("error" in callback) return NextResponse.json({ error: callback.error }, { status: 400 });
  const { requestId } = callback;

  const [req] = await db
    .select({ brand: schema.adCopyRequests.brand, status: schema.adCopyRequests.status })
    .from(schema.adCopyRequests)
    .where(eq(schema.adCopyRequests.id, requestId))
    .limit(1);
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // Quality Control gate — one review per concept not yet queued. Text rows carry no
  // client_id, so the client is resolved from the request's brand name.
  const toQueue = await db
    .select({
      id: schema.generatedAdCopy.id,
      primaryTextMedium: schema.generatedAdCopy.primaryTextMedium,
      headlines: schema.generatedAdCopy.headlines,
      ctaRecommendation: schema.generatedAdCopy.ctaRecommendation,
    })
    .from(schema.generatedAdCopy)
    .where(
      and(
        eq(schema.generatedAdCopy.requestId, requestId),
        isNull(schema.generatedAdCopy.qcReviewId),
        eq(schema.generatedAdCopy.qcStatus, "pending")
      )
    );
  await enqueueTextBatch(
    "ad_copy",
    toQueue.map((c) => ({
      id: c.id,
      // headlines is jsonb [{text, char_count}] — rendered, not String()'d into "[object Object]".
      copyText: [c.primaryTextMedium, renderValue(c.headlines), c.ctaRecommendation].filter(Boolean).join(" ") || null,
    })),
    await resolveTextClientId(req.brand)
  );

  const [{ saved }] = await db
    .select({ saved: sql<number>`count(*)::int` })
    .from(schema.generatedAdCopy)
    .where(eq(schema.generatedAdCopy.requestId, requestId));

  const update = callbackStatusUpdate({
    current: req.status,
    inFlightStatuses: ["new", "processing"],
    callback,
    saved,
    noun: "concepts",
  });
  if (update) {
    await db
      .update(schema.adCopyRequests)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(schema.adCopyRequests.id, requestId));
  }
  const status = update?.status ?? req.status;

  await db.insert(schema.activityLog).values({
    action: status === "error" ? "ad_copy_error" : "ad_copy_complete",
    resourceType: "ad_copy_request",
    resourceId: requestId,
    details: { status, conceptCount: saved, queuedForQc: toQueue.length, ...(callback.errorMessage ? { error: callback.errorMessage } : {}) },
  });

  return NextResponse.json({ ok: true, status, conceptCount: saved, queuedForQc: toQueue.length });
}
