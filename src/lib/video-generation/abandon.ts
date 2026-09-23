/**
 * Abandon clocks for video_generations. POST /api/video-generation/generate runs the whole
 * prompt pipeline inline; when the function times out it dies before it can mark the row,
 * leaving it `pending` forever and every poller spinning. These clocks turn such rows into
 * visible errors.
 */

import { db, schema } from "@/lib/db";
import { and, eq, isNull, lt } from "drizzle-orm";

type VideoRow = typeof schema.videoGenerations.$inferSelect;

/** The pipeline route is capped at 300s, so a `pending` row this old has no live writer. */
export const VIDEO_PIPELINE_ABANDON_MS = 10 * 60 * 1000;
/** Podcast renders can take an hour; a provider silent this long has lost the job. */
export const VIDEO_PROCESSING_ABANDON_MS = 6 * 60 * 60 * 1000;
/** A render retry claims its row before submitting; a claim with no request id this old died mid-submit. */
export const VIDEO_RETRY_SUBMIT_ABANDON_MS = 5 * 60 * 1000;

export const PIPELINE_ABANDONED_MESSAGE =
  "The prompt pipeline stopped before the video was submitted (it most likely timed out). Please try again.";
export const PROCESSING_ABANDONED_MESSAGE =
  "The video provider didn't return a result within 6 hours. Please try again.";
export const RETRY_SUBMIT_ABANDONED_MESSAGE =
  "The render retry was interrupted before the video service accepted it. Please retry the render.";

function ageMs(since: Date): number {
  return Date.now() - new Date(since).getTime();
}

export function isPipelineAbandoned(row: VideoRow): boolean {
  return row.status === "pending" && ageMs(row.createdAt) > VIDEO_PIPELINE_ABANDON_MS;
}

/**
 * Measured from `updatedAt` — the moment the row entered `processing` (nothing writes a
 * processing row until it finishes). From `createdAt`, a "Retry render" of an older row
 * would be declared abandoned on its first poll.
 */
export function isProcessingAbandoned(row: VideoRow): boolean {
  if (row.status !== "processing") return false;
  const limit = row.muapiRequestId ? VIDEO_PROCESSING_ABANDON_MS : VIDEO_RETRY_SUBMIT_ABANDON_MS;
  return ageMs(row.updatedAt) > limit;
}

export function processingAbandonedMessage(row: VideoRow): string {
  return row.muapiRequestId ? PROCESSING_ABANDONED_MESSAGE : RETRY_SUBMIT_ABANDONED_MESSAGE;
}

/**
 * Match one render ATTEMPT, not just the row. "Retry render" puts a failed row back into
 * `processing` on a new provider task, so a poll of the OLD task that finishes late (the
 * sweep walks rows one by one) must not overwrite the new attempt's state.
 */
export function sameAttempt(row: Pick<VideoRow, "id" | "muapiRequestId">) {
  return and(
    eq(schema.videoGenerations.id, row.id),
    row.muapiRequestId
      ? eq(schema.videoGenerations.muapiRequestId, row.muapiRequestId)
      : isNull(schema.videoGenerations.muapiRequestId)
  );
}

/** Fail one row, guarded on the status it was read with so a concurrent finish wins. */
export async function failVideoGeneration(row: VideoRow, message: string): Promise<VideoRow> {
  const [updated] = await db
    .update(schema.videoGenerations)
    .set({ status: "error", errorMessage: message, updatedAt: new Date() })
    .where(and(sameAttempt(row), eq(schema.videoGenerations.status, row.status)))
    .returning();
  if (updated) return updated;
  const [latest] = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, row.id))
    .limit(1);
  return latest ?? row;
}

/** Fail every stale `pending` row (optionally for one client). Returns how many. */
export async function failAbandonedPipelines(clientId?: string | null): Promise<number> {
  const cutoff = new Date(Date.now() - VIDEO_PIPELINE_ABANDON_MS);
  const conditions = [
    eq(schema.videoGenerations.status, "pending"),
    lt(schema.videoGenerations.createdAt, cutoff),
  ];
  if (clientId) conditions.push(eq(schema.videoGenerations.clientId, clientId));
  const failed = await db
    .update(schema.videoGenerations)
    .set({ status: "error", errorMessage: PIPELINE_ABANDONED_MESSAGE, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: schema.videoGenerations.id });
  return failed.length;
}
