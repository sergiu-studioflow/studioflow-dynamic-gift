/**
 * Apify client for the Review Scraping System.
 *
 * Uses the Google Maps Reviews Scraper actor (compass/Google-Maps-Reviews-Scraper,
 * id Xb8osYTtOjlsgI6k9) — the fleet-standard actor for business reviews. We start
 * a run (async), then poll it from the ingest sweep and pull the dataset items.
 *
 * Token resolution: getApiKey() checks the encrypted DB store first (client-
 * controlled in Settings → API Keys), falling back to process.env.APIFY_TOKEN.
 */

import { getApiKey } from "@/lib/api-keys";

const APIFY_API_BASE = "https://api.apify.com/v2";
export const GOOGLE_MAPS_REVIEWS_ACTOR_ID = "Xb8osYTtOjlsgI6k9";

async function token(): Promise<string> {
  const t = await getApiKey("APIFY_TOKEN");
  if (!t) throw new Error("APIFY_TOKEN is not configured");
  return t;
}

export type ApifyRunStatus =
  | "READY" | "RUNNING" | "SUCCEEDED" | "FAILED"
  | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED";

export type StartScrapeResult = { runId: string; datasetId: string | null };

/**
 * Start an async Google Maps reviews scrape for one brand.
 * Returns immediately with the runId (+ default dataset id) — poll with getRunStatus.
 */
export async function startReviewScrape(opts: {
  googleMapsUrl: string;
  maxReviews?: number;
}): Promise<StartScrapeResult> {
  const input = {
    startUrls: [{ url: opts.googleMapsUrl }],
    maxReviews: opts.maxReviews ?? 100,
    reviewsSort: "newest",
    language: "en",
    reviewsOrigin: "all",
  };

  const res = await fetch(
    `${APIFY_API_BASE}/acts/${GOOGLE_MAPS_REVIEWS_ACTOR_ID}/runs?token=${encodeURIComponent(await token())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify run start failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const data = json.data || {};
  if (!data.id) throw new Error(`Apify run start: no run id in response: ${JSON.stringify(json)}`);
  return { runId: data.id, datasetId: data.defaultDatasetId ?? null };
}

export type RunStatusResult = { status: ApifyRunStatus; datasetId: string | null };

export async function getRunStatus(runId: string): Promise<RunStatusResult> {
  const res = await fetch(
    `${APIFY_API_BASE}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(await token())}`,
    { method: "GET" }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify run status failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  const data = json.data || {};
  return { status: data.status as ApifyRunStatus, datasetId: data.defaultDatasetId ?? null };
}

/** Fetch dataset items (the scraped reviews). */
export async function getDatasetItems(datasetId: string, limit = 500): Promise<unknown[]> {
  const res = await fetch(
    `${APIFY_API_BASE}/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(
      await token()
    )}&clean=true&format=json&limit=${limit}`,
    { method: "GET" }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify dataset fetch failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

// Mirrors the existing `reviews` table (and the original n8n "Payload" mapping).
export type NormalizedReview = {
  reviewId: string;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerUrl: string | null;
  reviewerPhotoUrl: string | null;
  text: string | null;
  textTranslated: string | null;
  stars: number | null;
  language: string | null;
  originalLanguage: string | null;
  reviewImageUrls: string[];
  hasPhotos: boolean;
  reviewUrl: string | null;
  reviewOrigin: string | null;
  publishedAt: string | null;
  publishAtText: string | null;
  likesCount: number;
  responseFromOwnerText: string | null;
  responseFromOwnerDate: string | null;
  placeId: string | null;
  raw: unknown;
};

const orNull = (v: unknown): string | null =>
  v === undefined || v === null || v === "" ? null : String(v);

/**
 * Normalize one raw Apify review item into the `reviews` table shape. Mirrors
 * the field mapping proven in the original n8n workflow's "Payload" node.
 */
export function normalizeReview(rawItem: unknown): NormalizedReview | null {
  const raw = (rawItem ?? {}) as Record<string, unknown>;
  const reviewId = raw.reviewId ?? raw.reviewIdEncoded ?? raw.id;
  if (!reviewId) return null;

  const images: string[] = Array.isArray(raw.reviewImageUrls)
    ? (raw.reviewImageUrls as unknown[]).filter((u): u is string => typeof u === "string" && !!u)
    : [];

  const starsRaw = raw.stars ?? raw.rating ?? raw.score;
  const starsNum =
    typeof starsRaw === "number" ? Math.round(starsRaw) : starsRaw ? parseInt(String(starsRaw), 10) : NaN;

  return {
    reviewId: String(reviewId),
    reviewerId: orNull(raw.reviewerId),
    reviewerName: orNull(raw.name ?? raw.reviewerName),
    reviewerUrl: orNull(raw.reviewerUrl),
    reviewerPhotoUrl: orNull(raw.reviewerPhotoUrl),
    text: orNull(raw.text ?? raw.reviewDescription),
    textTranslated: orNull(raw.textTranslated),
    stars: Number.isFinite(starsNum) ? starsNum : null,
    language: orNull(raw.language),
    originalLanguage: orNull(raw.originalLanguage),
    reviewImageUrls: images,
    hasPhotos: images.length > 0,
    reviewUrl: orNull(raw.reviewUrl),
    reviewOrigin: orNull(raw.reviewOrigin),
    publishedAt: orNull(raw.publishedAtDate ?? raw.publishAt),
    publishAtText: orNull(raw.publishAt),
    likesCount: typeof raw.likesCount === "number" ? raw.likesCount : 0,
    responseFromOwnerText: orNull(raw.responseFromOwnerText),
    responseFromOwnerDate: orNull(raw.responseFromOwnerDate),
    placeId: orNull(raw.placeId),
    raw,
  };
}
