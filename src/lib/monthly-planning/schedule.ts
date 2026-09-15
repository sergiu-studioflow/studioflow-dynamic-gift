/**
 * Scheduling bridge — once a plan item's static ad is generated and cleared by Quality
 * Control, queue it as a post and schedule it on the item's planned date (feeds the
 * posting queue).
 */

import { db, schema } from "@/lib/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { queuePost } from "@/lib/posting/queue";
import { resolvePrefs, computeSlots, type PostingPrefs } from "@/lib/posting/slots";
import { localWallTimeToUtc, wallPartsInZone } from "@/lib/posting/tz";
import { isShippable } from "@/lib/qc/gate";
import { QC_HOLD_MESSAGE } from "@/lib/qc/release";

type PlanItem = typeof schema.planItems.$inferSelect;

export type ScheduleOutcome = "scheduled" | "generating" | "awaiting_qc" | "held" | "failed";

/** Post statuses whose time counts against a day's max-per-day and slot times. */
const OCCUPYING_STATUSES = ["scheduled", "publishing", "published", "partial"];
/** Never book a slot this close to now — the publisher only runs every 30 minutes. */
const MIN_LEAD_MS = 15 * 60_000;

const hhmm = (w: { hour: number; minute: number }) =>
  `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;

/**
 * The first free slot time on the planned date (brand timezone, honouring max-per-day and
 * times already booked), else the brand's next free slot after that date. Never in the past.
 */
export function chooseSlot(plannedDate: string, prefs: PostingPrefs, occupied: Date[], nowMs: number): Date | null {
  const [y, m, d] = plannedDate.split("-").map((x) => parseInt(x, 10));
  const dayStart = localWallTimeToUtc(y, m, d, 0, 0, prefs.timezone);

  // 1. The planned date itself (the plan chose it, so any weekday is fine).
  const sameDay = occupied
    .map((o) => wallPartsInZone(o, prefs.timezone))
    .filter((w) => w.year === y && w.month === m && w.day === d);
  if (sameDay.length < prefs.maxPerDay) {
    const taken = new Set(sameDay.map(hhmm));
    for (const slot of prefs.slotTimes) {
      if (taken.has(slot)) continue;
      const [hh, mm] = slot.split(":").map((x) => parseInt(x, 10));
      const at = localWallTimeToUtc(y, m, d, hh, mm, prefs.timezone);
      if (at.getTime() > nowMs + MIN_LEAD_MS) return at;
    }
  }

  // 2. Day full or already past → the next free slot. computeSlots starts the day after `from`.
  const from = new Date(Math.max(nowMs, dayStart.getTime()));
  const [next] = computeSlots(1, prefs, occupied, from);
  return next ?? null;
}

async function pickSlot(clientId: string, plannedDate: string, prefs: PostingPrefs): Promise<Date | null> {
  const now = Date.now();
  const [y, m, d] = plannedDate.split("-").map((x) => parseInt(x, 10));
  const dayStart = localWallTimeToUtc(y, m, d, 0, 0, prefs.timezone);

  const rows = await db
    .select({ scheduledAt: schema.scheduledPosts.scheduledAt })
    .from(schema.scheduledPosts)
    .where(
      and(
        eq(schema.scheduledPosts.clientId, clientId),
        inArray(schema.scheduledPosts.status, OCCUPYING_STATUSES),
        gte(schema.scheduledPosts.scheduledAt, new Date(Math.min(now, dayStart.getTime()) - 36 * 3600_000))
      )
    );
  const occupied = rows.map((r) => r.scheduledAt).filter((x): x is Date => !!x);
  return chooseSlot(plannedDate, prefs, occupied, now);
}

async function failItem(itemId: string, message: string): Promise<void> {
  await db
    .update(schema.planItems)
    .set({ status: "error", errorMessage: message, updatedAt: new Date() })
    .where(and(eq(schema.planItems.id, itemId), eq(schema.planItems.status, "producing")));
}

/**
 * The draft post for this item: the one an earlier, interrupted attempt already queued if
 * it is still usable, else a freshly queued one (linked immediately, so a later failure in
 * this attempt can never queue a second draft for the same ad).
 */
async function draftPostFor(item: PlanItem, userId: string | null): Promise<{ postId: string; alreadyScheduled: boolean }> {
  if (item.scheduledPostId) {
    const [existing] = await db
      .select({ id: schema.scheduledPosts.id, status: schema.scheduledPosts.status })
      .from(schema.scheduledPosts)
      .where(eq(schema.scheduledPosts.id, item.scheduledPostId))
      .limit(1);
    if (existing?.status === "draft") return { postId: existing.id, alreadyScheduled: false };
    if (existing?.status === "scheduled") return { postId: existing.id, alreadyScheduled: true };
  }

  const { postId } = await queuePost({
    sourceType: "static_ad",
    sourceId: item.generationId!,
    userId,
    platforms: Array.isArray(item.platforms) ? (item.platforms as string[]) : undefined,
  });
  await db
    .update(schema.planItems)
    .set({ scheduledPostId: postId, updatedAt: new Date() })
    .where(eq(schema.planItems.id, item.id));
  return { postId, alreadyScheduled: false };
}

/**
 * Queue + schedule a plan item whose static generation has completed. Returns what
 * happened; throws only on unexpected failures (the stepper errors the item).
 */
export async function scheduleGeneratedItem(item: PlanItem, userId: string | null): Promise<ScheduleOutcome> {
  if (!item.generationId) return "generating";

  const [gen] = await db
    .select({
      status: schema.staticAdGenerations.status,
      imageUrl: schema.staticAdGenerations.imageUrl,
      qcStatus: schema.staticAdGenerations.qcStatus,
    })
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, item.generationId))
    .limit(1);

  if (!gen) {
    await failItem(item.id, "Generation row missing — use Retry to produce it again.");
    return "failed";
  }
  if (gen.status === "error") {
    await failItem(item.id, "Generation failed — use Retry to produce it again.");
    return "failed";
  }
  if ((gen.status !== "completed" && gen.status !== "complete") || !gen.imageUrl) return "generating";

  // Quality Control gate. This is the ONLY path in the portal that takes a generated
  // creative to a live Facebook/Instagram publish with no human in the loop, so the gate
  // is load-bearing here rather than advisory.
  //   pending  → keep waiting; the next sweep retries once a verdict lands (no timeout).
  //   held     → park the item with an explicit message. Approving the creative in the QC
  //              queue calls releaseHeldPlanItem(), which puts it back to 'producing' so
  //              the next sweep schedules it at the originally planned date.
  if (gen.qcStatus === "pending") return "awaiting_qc";
  if (!isShippable(gen.qcStatus)) {
    await failItem(item.id, QC_HOLD_MESSAGE);
    return "held";
  }

  // 1. Queue the generated ad as a draft post (or reuse the one already queued).
  const { postId, alreadyScheduled } = await draftPostFor(item, userId);

  if (!alreadyScheduled) {
    // 2. The planned date's first free slot, bumped forward if the day is full or past.
    const [brand] = await db.select({ settings: schema.brands.settings }).from(schema.brands).where(eq(schema.brands.id, item.clientId)).limit(1);
    const prefs = resolvePrefs((brand?.settings as Record<string, unknown>)?.posting);
    const scheduledAt = await pickSlot(item.clientId, item.plannedDate, prefs);
    if (!scheduledAt) throw new Error("No free posting slot in the next year — check the brand's posting schedule");

    // 3. Resolve targets + mark the post scheduled.
    const targets = await db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, postId));
    for (const t of targets.filter((x) => x.enabled)) {
      const [acct] = await db
        .select({ id: schema.socialAccounts.id })
        .from(schema.socialAccounts)
        .where(and(eq(schema.socialAccounts.clientId, item.clientId), eq(schema.socialAccounts.platform, t.platform), eq(schema.socialAccounts.enabled, true)))
        .limit(1);
      await db.update(schema.postTargets).set({ socialAccountId: acct?.id ?? null, status: "pending", updatedAt: new Date() }).where(eq(schema.postTargets.id, t.id));
    }
    await db
      .update(schema.scheduledPosts)
      // Re-stamp the timezone in case prefs changed between queueing and scheduling.
      .set({ status: "scheduled", scheduledAt, timezone: prefs.timezone, approvedBy: userId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, postId));
  }

  // 4. Link + advance the plan item.
  await db
    .update(schema.planItems)
    .set({ scheduledPostId: postId, status: "scheduled", errorMessage: null, updatedAt: new Date() })
    .where(eq(schema.planItems.id, item.id));

  return "scheduled";
}
