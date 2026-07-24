import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { computeSlots, resolvePrefs } from "@/lib/posting/slots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/posting/schedule
 * Body: { clientId, postIds: string[], mode: "auto" | "manual", scheduledAt? }
 * Bulk approve + schedule. "auto" fills the brand's next free slots; "manual"
 * puts every selected post at the same given time.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { clientId, postIds, mode } = body;
  if (!clientId || !Array.isArray(postIds) || postIds.length === 0) {
    return NextResponse.json({ error: "clientId and a non-empty postIds[] are required" }, { status: 400 });
  }

  // Only schedule posts that belong to this client and are draft/scheduled.
  const posts = await db
    .select()
    .from(schema.scheduledPosts)
    .where(and(eq(schema.scheduledPosts.clientId, clientId), inArray(schema.scheduledPosts.id, postIds)));
  const schedulable = posts.filter((p) => ["draft", "scheduled"].includes(p.status));
  if (!schedulable.length) return NextResponse.json({ error: "No schedulable posts in selection" }, { status: 400 });

  // Compute the target time(s).
  let times: Date[];
  if (mode === "manual") {
    const at = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!at || isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "manual mode needs a valid future scheduledAt" }, { status: 400 });
    }
    times = schedulable.map(() => at);
  } else {
    const [brand] = await db.select({ settings: schema.brands.settings }).from(schema.brands).where(eq(schema.brands.id, clientId)).limit(1);
    const prefs = resolvePrefs((brand?.settings as Record<string, unknown>)?.posting);
    const occupied = await db
      .select({ scheduledAt: schema.scheduledPosts.scheduledAt })
      .from(schema.scheduledPosts)
      .where(and(eq(schema.scheduledPosts.clientId, clientId), eq(schema.scheduledPosts.status, "scheduled"), gte(schema.scheduledPosts.scheduledAt, new Date())));
    const occupiedTimes = occupied.map((o) => o.scheduledAt).filter((d): d is Date => !!d);
    times = computeSlots(schedulable.length, prefs, occupiedTimes, new Date());
    if (times.length < schedulable.length) {
      return NextResponse.json({ error: "Not enough free slots in the scheduling window — add more slot times or reduce selection." }, { status: 400 });
    }
  }

  // Apply: resolve accounts + schedule each post.
  const scheduled: string[] = [];
  for (let i = 0; i < schedulable.length; i++) {
    const p = schedulable[i];
    const at = times[i];
    const targets = await db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, p.id));
    for (const t of targets.filter((x) => x.enabled)) {
      const [acct] = await db
        .select({ id: schema.socialAccounts.id })
        .from(schema.socialAccounts)
        .where(and(eq(schema.socialAccounts.clientId, clientId), eq(schema.socialAccounts.platform, t.platform), eq(schema.socialAccounts.enabled, true)))
        .limit(1);
      await db.update(schema.postTargets).set({ socialAccountId: acct?.id ?? null, status: "pending", updatedAt: new Date() }).where(eq(schema.postTargets.id, t.id));
    }
    await db
      .update(schema.scheduledPosts)
      .set({ status: "scheduled", scheduledAt: at, approvedBy: auth.portalUser.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, p.id));
    scheduled.push(p.id);
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    clientId,
    action: "posts_bulk_scheduled",
    resourceType: "scheduled_post",
    details: { count: scheduled.length, mode },
  });

  return NextResponse.json({ scheduled: scheduled.length, times: times.slice(0, schedulable.length).map((t) => t.toISOString()) });
}
