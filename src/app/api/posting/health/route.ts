import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getApiKey } from "@/lib/api-keys";
import { resolvePrefs } from "@/lib/posting/slots";

export const dynamic = "force-dynamic";

/** Past due by this much and still unpublished → surfaced as overdue (the publisher runs every 30 min). */
const OVERDUE_MINUTES = 45;

/**
 * GET /api/posting/health?clientId=
 * What the Post Scheduler needs to explain why posts aren't going out: whether the Meta
 * System User token is configured, each connected account's stored health, how many
 * posts are overdue, and the brand's posting timezone. Reads stored state only — no Meta calls.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const [token, accounts, brandRows, overdueRows] = await Promise.all([
    getApiKey("META_SYSTEM_USER_TOKEN"),
    db
      .select({
        platform: schema.socialAccounts.platform,
        enabled: schema.socialAccounts.enabled,
        health: schema.socialAccounts.health,
        healthError: schema.socialAccounts.healthError,
        externalName: schema.socialAccounts.externalName,
      })
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.clientId, clientId)),
    db.select({ settings: schema.brands.settings }).from(schema.brands).where(eq(schema.brands.id, clientId)).limit(1),
    db
      .select({ n: sql<number>`count(distinct ${schema.scheduledPosts.id})::int` })
      .from(schema.scheduledPosts)
      .innerJoin(schema.postTargets, eq(schema.postTargets.postId, schema.scheduledPosts.id))
      .where(
        and(
          eq(schema.scheduledPosts.clientId, clientId),
          inArray(schema.scheduledPosts.status, ["scheduled", "publishing"]),
          lt(schema.scheduledPosts.scheduledAt, new Date(Date.now() - OVERDUE_MINUTES * 60_000)),
          eq(schema.postTargets.enabled, true),
          eq(schema.postTargets.status, "pending")
        )
      ),
  ]);

  return NextResponse.json({
    tokenConfigured: !!token.trim(),
    timezone: resolvePrefs((brandRows[0]?.settings as Record<string, unknown> | undefined)?.posting).timezone,
    accounts,
    overdueCount: overdueRows[0]?.n ?? 0,
    overdueMinutes: OVERDUE_MINUTES,
  });
}
