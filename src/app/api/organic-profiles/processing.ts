import { db, schema } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";

/** A profile scrape normally finishes within minutes; still Processing after this, it's treated as failed. */
export const PROCESSING_STALE_MS = 2 * 60 * 60 * 1000;

/** activity_log action recorded each time a profile scrape is triggered. */
export const INITIALIZE_ACTION = "organic_profile_initialize";

type ProfileRow = Pick<
  typeof schema.organicProfiles.$inferSelect,
  "id" | "trackingStatus" | "lastScrapedAt" | "createdAt"
>;

/**
 * When each Processing profile's scrape was triggered. organic_profiles has no
 * status timestamp (and its other timestamps are written by the n8n scraper),
 * so the initialize route logs to activity_log; profiles triggered before that
 * existed fall back to their last scrape, or creation, time.
 */
export async function processingStartedAt(profiles: ProfileRow[]): Promise<Map<number, Date>> {
  const processing = profiles.filter((p) => p.trackingStatus === "Processing");
  const startedAt = new Map<number, Date>();
  if (processing.length === 0) return startedAt;

  const profileIdExpr = sql<string>`${schema.activityLog.details}->>'profileId'`;
  const rows = await db
    .select({ profileId: profileIdExpr, triggeredAt: sql<string>`max(${schema.activityLog.createdAt})` })
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.action, INITIALIZE_ACTION),
        inArray(profileIdExpr, processing.map((p) => String(p.id)))
      )
    )
    .groupBy(profileIdExpr);
  const logged = new Map(rows.map((r) => [String(r.profileId), new Date(r.triggeredAt)]));

  for (const p of processing) {
    startedAt.set(p.id, logged.get(String(p.id)) ?? p.lastScrapedAt ?? p.createdAt);
  }
  return startedAt;
}

export function isProcessingStale(startedAt: Date | undefined, now = Date.now()): boolean {
  return !!startedAt && now - startedAt.getTime() > PROCESSING_STALE_MS;
}
