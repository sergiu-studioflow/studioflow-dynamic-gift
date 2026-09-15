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
  if (!t) throw new Error("No Apify API token is configured (APIFY_TOKEN) — add the Apify key under Settings → API Keys.");
  return t;
}

/**
 * Turn a failed Apify response into a readable error. Apify error bodies look
 * like {"error":{"type":"platform-feature-disabled","message":"Monthly usage hard limit exceeded"}}.
 * The monthly usage cap is called out explicitly: the account is shared across
 * portals, so hitting it blocks every run until it resets or is raised.
 */
async function apifyError(action: string, res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  let type = "";
  let message = text.trim().slice(0, 300);
  try {
    const parsed = JSON.parse(text) as { error?: { type?: unknown; message?: unknown } };
    if (parsed?.error) {
      type = String(parsed.error.type ?? "");
      message = String(parsed.error.message ?? message);
    }
  } catch {
    // not JSON — keep the raw text
  }
  const detail = `Apify ${res.status}${message ? `: ${message}` : ""}`;
  const usageLimit =
    res.status === 402 ||
    /monthly usage|usage (hard )?limit/i.test(message) ||
    (type === "platform-feature-disabled" && /usage|limit|credit/i.test(message));
  if (usageLimit) {
    return new Error(
      `The shared Apify account has reached its monthly usage limit, so ${action} is blocked until the limit resets or is raised (${detail}).`
    );
  }
  return new Error(`${action.charAt(0).toUpperCase()}${action.slice(1)} failed (${detail}).`);
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
    throw await apifyError("starting the review scrape", res);
  }

  const json = await res.json();
  const data = json.data || {};
  if (!data.id) throw new Error(`Apify run start: no run id in response: ${JSON.stringify(json)}`);
  return { runId: data.id, datasetId: data.defaultDatasetId ?? null };
}

export type RunStatusResult = {
  status: ApifyRunStatus;
  datasetId: string | null;
  /** Apify's human-readable reason, e.g. why a run failed. */
  statusMessage: string | null;
};

export async function getRunStatus(runId: string): Promise<RunStatusResult> {
  const res = await fetch(
    `${APIFY_API_BASE}/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(await token())}`,
    { method: "GET" }
  );
  if (!res.ok) {
    throw await apifyError("checking the review scrape", res);
  }
  const json = await res.json();
  const data = json.data || {};
  return {
    status: data.status as ApifyRunStatus,
    datasetId: data.defaultDatasetId ?? null,
    statusMessage: typeof data.statusMessage === "string" && data.statusMessage ? data.statusMessage : null,
  };
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
    throw await apifyError("downloading the scraped reviews", res);
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
