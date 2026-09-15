import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getAppConfig } from "@/lib/config";
import { eq, desc, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { DEFAULT_META_AD_COUNTRY, isMetaAdCountry } from "@/components/competitor-ads/countries";

export const dynamic = "force-dynamic";

/** n8n error bodies look like {"code":404,"message":"The requested webhook ... is not registered."}. */
async function webhookFailureDetail(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}

/**
 * POST /api/competitor-ads/refresh — trigger n8n Meta scrape (fire-and-forget)
 * Body: { competitorId, clientId, country? }
 * Uses clientCompetitors table (not competitorSources) for multi-client.
 * `country` defaults to AU: client_competitors has no country column.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot trigger scrapes" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const competitorId = body.competitorId || body.sourceId;
  const clientId = body.clientId;
  const country = String(body.country || DEFAULT_META_AD_COUNTRY).trim().toUpperCase();
  if (!competitorId) {
    return NextResponse.json({ error: "Missing competitorId" }, { status: 400 });
  }
  if (!clientId) {
    return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  }
  if (!isMetaAdCountry(country)) {
    return NextResponse.json({ error: `Unsupported Meta Ad Library country "${country}"` }, { status: 400 });
  }

  // Fetch competitor from clientCompetitors table (must belong to this brand)
  const [competitor] = await db
    .select()
    .from(schema.clientCompetitors)
    .where(and(eq(schema.clientCompetitors.id, competitorId), eq(schema.clientCompetitors.clientId, clientId)))
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
    return NextResponse.json(
      { error: 'The Meta ads scraper webhook isn\'t configured (app_config workflows "competitor_ads_scraper").' },
      { status: 500 }
    );
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
  // Resolve client_slug from storage_prefix so the n8n scraper writes media to
  // brands/<agency>/<client_slug>/scraped/... instead of agency-level scraped/.
  const storagePrefix = await getClientStoragePrefix(clientId);
  const clientSlug = storagePrefix ? storagePrefix.split("/").pop() ?? null : null;


  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          meta_library_url: metaLibraryUrl,
          country,
          client_id: clientId,
          client_slug: clientSlug,
        },
      ]),
    });

    if (!res.ok) {
      const detail = await webhookFailureDetail(res);
      return NextResponse.json(
        { error: `The Meta ads scraper didn't accept the request (HTTP ${res.status})${detail ? `: ${detail}` : ""}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      triggered: true,
      country,
      competitorPageId: competitor.metaPageId,
      previousSnapshotId: latestSnapshot?.snapshotId || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Couldn't reach the Meta ads scraper: ${err instanceof Error ? err.message : "network error"}` },
      { status: 502 }
    );
  }
}
