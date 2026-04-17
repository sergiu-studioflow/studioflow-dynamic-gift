import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getAppConfig } from "@/lib/config";
import { eq, desc, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/competitor-ads/refresh — trigger n8n Meta scrape (fire-and-forget)
 * Body: { competitorId, clientId }
 * Uses clientCompetitors table (not competitorSources) for multi-client.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot trigger scrapes" }, { status: 403 });
  }

  const body = await request.json();
  const competitorId = body.competitorId || body.sourceId;
  const clientId = body.clientId;
  const country = (body.country || "ALL").trim().toUpperCase();
  if (!competitorId) {
    return NextResponse.json({ error: "Missing competitorId" }, { status: 400 });
  }
  if (!clientId) {
    return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  }

  // Fetch competitor from clientCompetitors table
  const [competitor] = await db
    .select()
    .from(schema.clientCompetitors)
    .where(eq(schema.clientCompetitors.id, competitorId))
    .limit(1);

  if (!competitor) {
    return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
  }

  if (!competitor.metaPageId) {
    return NextResponse.json({ error: "Competitor has no Meta Page ID configured" }, { status: 400 });
  }

  // Build Meta Library URL from page ID
  const metaLibraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(country)}&view_all_page_id=${competitor.metaPageId}&search_type=page&media_type=all`;

  const config = await getAppConfig();
  const wfConfig = config?.workflows?.competitor_ads_scraper as string | { webhook_path?: string; n8n_base_url?: string } | undefined;
  const webhookUrl = typeof wfConfig === "string"
    ? wfConfig
    : wfConfig?.webhook_path
      ? `${wfConfig.n8n_base_url || "https://studio-flow.app.n8n.cloud/webhook"}/${wfConfig.webhook_path}`
      : null;

  if (!webhookUrl) {
    return NextResponse.json({ error: "Scraper webhook not configured" }, { status: 500 });
  }

  // Get latest snapshot before triggering
  const [latestSnapshot] = await db
    .selectDistinct({ snapshotId: schema.competitorAds.snapshotId })
    .from(schema.competitorAds)
    .where(
      and(
        eq(schema.competitorAds.competitorPageId, competitor.metaPageId),
        eq(schema.competitorAds.clientId, clientId)
      )
    )
    .orderBy(desc(schema.competitorAds.snapshotId))
    .limit(1);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          meta_library_url: metaLibraryUrl,
          country,
          client_id: clientId,
        },
      ]),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to trigger scrape" }, { status: 502 });
    }

    return NextResponse.json({
      triggered: true,
      competitorPageId: competitor.metaPageId,
      previousSnapshotId: latestSnapshot?.snapshotId || null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to reach n8n webhook" }, { status: 502 });
  }
}
