/**
 * Static-Ad Prompt Builder — layered web research helpers.
 *
 * The PRIMARY research engine is Opus + native web_search/web_fetch (see
 * stages.ts Stage A) — it needs only ANTHROPIC_API_KEY and does the bulk of the
 * brand-DNA research inline (design agency, fonts, hex, packaging, brand story,
 * competitors) by searching and reading the brand site itself.
 *
 * These helpers are best-effort SUPPLEMENTS that raise quality when their keys
 * are present and degrade silently to null/[] when they are not:
 *   - Tavily: deep crawl/map of the brand site for the full product/service
 *     catalog and rich page content.
 *   - Apify: pull the brand's live Meta Ad Library creatives as vision inputs.
 *
 * Every function here is best-effort: it never throws — a missing key or a
 * failed call returns null/[] so the pipeline continues on the Opus-only path.
 */

import { getApiKey } from "@/lib/api-keys";

async function keyOrNull(name: string): Promise<string | null> {
  try {
    const k = await getApiKey(name);
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

/**
 * fetch with a hard wall-clock timeout. Supplements (Tavily/Apify) are
 * best-effort — a slow/hung call must never blow the serverless budget, so we
 * abort and the caller degrades to []. Default 20s; Apify sync runs get more.
 */
async function tfetch(url: string, init: RequestInit, ms = 20000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

// ─── Tavily ──────────────────────────────────────────────────────────────────

export type TavilyResult = { url: string; content: string };

export async function tavilySearch(
  query: string,
  opts?: { maxResults?: number },
): Promise<TavilyResult[]> {
  const key = await keyOrNull("TAVILY_API_KEY");
  if (!key) return [];
  try {
    const res = await tfetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "advanced",
        max_results: opts?.maxResults ?? 6,
        include_raw_content: true,
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: Array<{ url?: string; content?: string; raw_content?: string }> };
    return (json.results ?? [])
      .map((r) => ({ url: r.url ?? "", content: (r.raw_content || r.content || "").slice(0, 12000) }))
      .filter((r) => r.url);
  } catch {
    return [];
  }
}

/** Enumerate URLs on a site (for catalog discovery). */
export async function tavilyMap(url: string, opts?: { maxResults?: number }): Promise<string[]> {
  const key = await keyOrNull("TAVILY_API_KEY");
  if (!key) return [];
  try {
    const res = await tfetch("https://api.tavily.com/map", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, url, max_depth: 2, limit: opts?.maxResults ?? 50 }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: string[]; urls?: string[] };
    return (json.results || json.urls || []).slice(0, opts?.maxResults ?? 50);
  } catch {
    return [];
  }
}

/** Extract clean markdown content from specific URLs. */
export async function tavilyExtract(urls: string[]): Promise<TavilyResult[]> {
  const key = await keyOrNull("TAVILY_API_KEY");
  if (!key || urls.length === 0) return [];
  try {
    const res = await tfetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, urls: urls.slice(0, 20), extract_depth: "advanced", format: "markdown" }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: Array<{ url?: string; raw_content?: string; content?: string }> };
    return (json.results ?? [])
      .map((r) => ({ url: r.url ?? "", content: (r.raw_content || r.content || "").slice(0, 12000) }))
      .filter((r) => r.url);
  } catch {
    return [];
  }
}

// ─── Apify — Meta Ad Library creatives ────────────────────────────────────────

/**
 * Pull the brand's live ad creatives from the Meta Ad Library via Apify, to feed
 * as vision inputs into Stage A. Best-effort: returns [] if APIFY_TOKEN is unset
 * or the run fails. Actor id is configurable via the META_ADS_ACTOR env var.
 */
export async function fetchMetaAdImages(
  brandName: string,
  opts?: { limit?: number },
): Promise<string[]> {
  const token = await keyOrNull("APIFY_TOKEN");
  if (!token) return [];
  const actor = (process.env.META_ADS_ACTOR || "apify~facebook-ads-scraper").trim();
  try {
    const res = await tfetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Common input shape; actors vary — tolerate non-matching fields.
          searchTerms: [brandName],
          count: opts?.limit ?? 8,
          "max-items": opts?.limit ?? 8,
        }),
      },
      35000,
    );
    if (!res.ok) return [];
    const items = (await res.json()) as Array<Record<string, unknown>>;
    const urls: string[] = [];
    for (const item of items) {
      // Tolerate several common shapes for ad-creative image URLs.
      const candidates = [
        item.imageUrl,
        item.image,
        item.thumbnailUrl,
        (item.snapshot as { images?: Array<{ original_image_url?: string }> } | undefined)?.images?.[0]
          ?.original_image_url,
      ].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
      urls.push(...candidates);
      if (urls.length >= (opts?.limit ?? 8)) break;
    }
    return urls.slice(0, opts?.limit ?? 8);
  } catch {
    return [];
  }
}
