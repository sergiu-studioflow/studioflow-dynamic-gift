/**
 * Scheduling bridge — once a plan item's static ad is generated, queue it as a
 * post and schedule it to the item's planned date (feeds the posting queue).
 */

import { db, schema } from "@/lib/db";
import { and, eq, gte } from "drizzle-orm";
import { queuePost } from "@/lib/posting/queue";
import { resolvePrefs, computeSlots } from "@/lib/posting/slots";
import { localWallTimeToUtc } from "@/lib/posting/tz";

type PlanItem = typeof schema.planItems.$inferSelect;

/** Build the UTC instant for `plannedDate` at the brand's first slot time. */
function slotForDate(plannedDate: string, prefs: ReturnType<typeof resolvePrefs>): Date {
  const [y, m, d] = plannedDate.split("-").map((x) => parseInt(x, 10));
  const [hh, mm] = (prefs.slotTimes[0] || "09:00").split(":").map((x) => parseInt(x, 10));
  return localWallTimeToUtc(y, m, d, hh, mm, prefs.timezone);
}

/**
 * Queue + schedule a plan item whose static generation has completed.
 * Returns true if it scheduled, false if not ready.
 */
export async function scheduleGeneratedItem(item: PlanItem, userId: string | null): Promise<boolean> {
  if (!item.generationId) return false;

  const [gen] = await db
    .select({ status: schema.staticAdGenerations.status, imageUrl: schema.staticAdGenerations.imageUrl })
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, item.generationId))
    .limit(1);

  if (!gen) {
    await db.update(schema.planItems).set({ status: "error", errorMessage: "Generation row missing", updatedAt: new Date() }).where(eq(schema.planItems.id, item.id));
    return false;
  }
  if (gen.status === "error") {
    await db.update(schema.planItems).set({ status: "error", errorMessage: "Generation failed", updatedAt: new Date() }).where(eq(schema.planItems.id, item.id));
    return false;
  }
  if (gen.status !== "completed" || !gen.imageUrl) return false; // still generating

  // 1. Queue the generated ad as a draft post.
  const { postId } = await queuePost({ sourceType: "static_ad", sourceId: item.generationId, userId });

  // 2. Compute the scheduled time for the planned date (bump forward if past / occupied).
  const [brand] = await db.select({ settings: schema.brands.settings }).from(schema.brands).where(eq(schema.brands.id, item.clientId)).limit(1);
  const prefs = resolvePrefs((brand?.settings as Record<string, unknown>)?.posting);
  let scheduledAt = slotForDate(item.plannedDate, prefs);
  if (scheduledAt.getTime() <= Date.now()) {
    const occupied = await db
      .select({ scheduledAt: schema.scheduledPosts.scheduledAt })
      .from(schema.scheduledPosts)
      .where(and(eq(schema.scheduledPosts.clientId, item.clientId), eq(schema.scheduledPosts.status, "scheduled"), gte(schema.scheduledPosts.scheduledAt, new Date())));
    const [next] = computeSlots(1, prefs, occupied.map((o) => o.scheduledAt).filter((x): x is Date => !!x), new Date());
    if (next) scheduledAt = next;
  }

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
    .set({ status: "scheduled", scheduledAt, approvedBy: userId, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.scheduledPosts.id, postId));

  // 4. Link + advance the plan item.
  await db
    .update(schema.planItems)
    .set({ scheduledPostId: postId, status: "scheduled", updatedAt: new Date() })
    .where(eq(schema.planItems.id, item.id));

  return true;
}
