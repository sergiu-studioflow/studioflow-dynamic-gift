/**
 * Review scrape runs (async Apify Google Maps review scrapes, one row per run in
 * review_scrape_runs). Shared by the scheduled crons (/api/cron/review-ingest,
 * /api/cron/review-sweep) and the Reviews tab's "Pull latest reviews"
 * (/api/review-graphics/reviews/fetch), which members use — cron routes are
 * admin-only.
 *
 * A run stays `scraping` until the sweep ingests it or marks it `error`. The
 * timeout keeps a dead run from blocking the nightly ingest and "Pull latest"
 * forever.
 */

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  getDatasetItems,
  getRunStatus,
  normalizeReview,
  startReviewScrape,
  type ApifyRunStatus,
} from "@/lib/apify";
import { uploadToR2 } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { BRAND_SLUG } from "@/lib/static-ads/config";

type ScrapeRun = typeof schema.reviewScrapeRuns.$inferSelect;

/** A review scrape normally finishes within minutes. */
export const SCRAPE_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const TIMEOUT_LABEL = "2 hours";
const NO_RUN_ID_REASON = "No Apify run id was recorded for this fetch, so its results can't be collected.";

const MAX_PHOTOS_PER_REVIEW = 4;

export function isScrapeRunStale(run: { startedAt: Date | string }, now = Date.now()): boolean {
  return now - new Date(run.startedAt).getTime() > SCRAPE_RUN_TIMEOUT_MS;
}

/**
 * Why a run should be failed given its Apify status, or null while it may
 * still finish (or has succeeded and just needs ingesting).
 */
function scrapeRunFailure(status: ApifyRunStatus, statusMessage: string | null, stale: boolean): string | null {
  if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
    return `Apify run ${status}${statusMessage ? `: ${statusMessage}` : ""}`;
  }
  if (stale && status !== "SUCCEEDED") {
    return `Timed out: the Apify run was still ${status || "in an unknown state"} after ${TIMEOUT_LABEL}.`;
  }
  return null;
}

function gaveUpReason(message: string): string {
  return `Gave up after ${TIMEOUT_LABEL}: ${message}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Mark a run failed — only while it's still in flight, so a concurrent ingest isn't overwritten. */
async function failScrapeRun(runId: string, reason: string): Promise<void> {
  await db
    .update(schema.reviewScrapeRuns)
    .set({ status: "error", errorMessage: reason, completedAt: new Date() })
    .where(and(eq(schema.reviewScrapeRuns.id, runId), eq(schema.reviewScrapeRuns.status, "scraping")));
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

/** Download a review's customer photos to R2; returns the public R2 urls (best-effort). */
async function archivePhotos(opts: {
  externalReviewId: string;
  clientId: string | null;
  imageUrls: string[];
}): Promise<string[]> {
  const prefix = opts.clientId ? await getClientStoragePrefix(opts.clientId) : null;
  const base = prefix || `brands/${BRAND_SLUG}`;
  const out: string[] = [];
  const urls = opts.imageUrls.slice(0, MAX_PHOTOS_PER_REVIEW);

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i]);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpg";
      const key = `${base}/review-system/review-images/${safeName(opts.externalReviewId)}-${i}.${ext}`;
      const url = await uploadToR2(key, buffer, contentType);
      out.push(url);
    } catch (err) {
      // continueOnFail — Google CDN urls can 403/expire; skip this image
      console.error(`[review-sweep] photo archive failed (${opts.externalReviewId}#${i}):`, err);
    }
  }
  return out;
}

/** Ingest one finished scrape run: upsert reviews + archive photos for new qualifying ones. */
async function ingestRun(run: ScrapeRun, datasetId: string) {
  const items = await getDatasetItems(datasetId, 500);
  const normalized = items.map(normalizeReview).filter((r): r is NonNullable<typeof r> => r !== null);

  // The reviews table has NOT NULL stars + place_id; a single bad row fails the
  // whole multi-row insert, so drop malformed items. `has_photos` and
  // `qualifies_for_render` are GENERATED columns — never insert them.
  const valid = normalized.filter((n) => n.stars != null && n.placeId != null);

  let newCount = 0;
  if (valid.length > 0) {
    const values = valid.map((n) => ({
      reviewId: n.reviewId,
      brandId: run.clientId,
      reviewerId: n.reviewerId,
      reviewerName: n.reviewerName,
      reviewerUrl: n.reviewerUrl,
      reviewerPhotoUrl: n.reviewerPhotoUrl,
      text: n.text,
      textTranslated: n.textTranslated,
      stars: n.stars,
      language: n.language,
      originalLanguage: n.originalLanguage,
      reviewImageUrls: n.reviewImageUrls,
      reviewUrl: n.reviewUrl,
      reviewOrigin: n.reviewOrigin,
      publishedAt: n.publishedAt ? new Date(n.publishedAt) : null,
      publishAtText: n.publishAtText,
      likesCount: n.likesCount,
      responseFromOwnerText: n.responseFromOwnerText,
      responseFromOwnerDate: n.responseFromOwnerDate ? new Date(n.responseFromOwnerDate) : null,
      placeId: n.placeId,
      rawData: n.raw,
    }));

    // ON CONFLICT (review_id) DO NOTHING — returns only newly inserted rows
    const inserted = await db
      .insert(schema.reviews)
      .values(values)
      .onConflictDoNothing({ target: schema.reviews.reviewId })
      .returning({
        reviewId: schema.reviews.reviewId,
        stars: schema.reviews.stars,
        reviewImageUrls: schema.reviews.reviewImageUrls,
      });
    newCount = inserted.length;
  }

  // Archive customer photos to R2 for ALL qualifying reviews that lack an
  // archive, using the FRESH scrape URLs (Google CDN urls expire/403 over time
  // — R2 copies are permanent + hotlinkable). Refresh review_image_urls too so
  // the stored urls match what we archived. Only reviews present in this scrape
  // window can be archived; older ones get picked up by a larger scrape.
  if (valid.length > 0 && run.clientId) {
    const freshById = new Map(valid.map((n) => [n.reviewId, n.reviewImageUrls]));
    const needArchive = await db
      .select({ reviewId: schema.reviews.reviewId })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.brandId, run.clientId),
          eq(schema.reviews.qualifiesForRender, true),
          sql`jsonb_array_length(coalesce(${schema.reviews.archivedImageUrls}, '[]'::jsonb)) = 0`
        )
      );
    for (const row of needArchive) {
      const fresh = freshById.get(row.reviewId);
      if (!fresh || fresh.length === 0) continue; // not in this scrape window
      const archived = await archivePhotos({
        externalReviewId: row.reviewId,
        clientId: run.clientId,
        imageUrls: fresh,
      });
      if (archived.length > 0) {
        await db
          .update(schema.reviews)
          .set({ archivedImageUrls: archived, reviewImageUrls: fresh })
          .where(eq(schema.reviews.reviewId, row.reviewId));
      }
    }
  }

  await db
    .update(schema.reviewScrapeRuns)
    .set({
      status: "complete",
      reviewsFound: normalized.length,
      reviewsNew: newCount,
      completedAt: new Date(),
      apifyDatasetId: datasetId,
      errorMessage: null,
    })
    .where(eq(schema.reviewScrapeRuns.id, run.id));

  return { found: normalized.length, new: newCount };
}

export type ScrapeSweepResult = {
  scrapeRuns: number;
  runsCompleted: number;
  runsFailed: number;
  stillRunning: number;
  reviewsNew: number;
};

/**
 * Poll in-flight scrape runs (optionally for one brand): ingest finished ones,
 * and mark failed any that can't finish — no Apify run id, failed on Apify, or
 * unresolved past the timeout — with the reason.
 */
export async function sweepScrapeRuns(opts: { clientId?: string | null } = {}): Promise<ScrapeSweepResult> {
  const inFlight = await db
    .select()
    .from(schema.reviewScrapeRuns)
    .where(
      opts.clientId
        ? and(eq(schema.reviewScrapeRuns.status, "scraping"), eq(schema.reviewScrapeRuns.clientId, opts.clientId))
        : eq(schema.reviewScrapeRuns.status, "scraping")
    );

  const result: ScrapeSweepResult = {
    scrapeRuns: inFlight.length,
    runsCompleted: 0,
    runsFailed: 0,
    stillRunning: 0,
    reviewsNew: 0,
  };

  for (const run of inFlight) {
    const stale = isScrapeRunStale(run);
    try {
      if (!run.apifyRunId) {
        await failScrapeRun(run.id, NO_RUN_ID_REASON);
        result.runsFailed++;
        continue;
      }
      const { status, datasetId, statusMessage } = await getRunStatus(run.apifyRunId);
      if (status === "SUCCEEDED") {
        const ds = datasetId || run.apifyDatasetId;
        if (!ds) {
          await failScrapeRun(run.id, "The Apify run finished but returned no dataset id.");
          result.runsFailed++;
          continue;
        }
        const r = await ingestRun(run, ds);
        result.reviewsNew += r.new;
        result.runsCompleted++;
        continue;
      }
      const failure = scrapeRunFailure(status, statusMessage, stale);
      if (failure) {
        await failScrapeRun(run.id, failure);
        result.runsFailed++;
      } else {
        result.stillRunning++;
      }
    } catch (err) {
      console.error(`[review-sweep] run ${run.id}:`, err);
      try {
        // Past the timeout and already failed a previous check → give up. One
        // failure alone isn't enough: the nightly run is first swept hours after
        // it starts, and a transient error then shouldn't discard it.
        if (stale && run.errorMessage) {
          await failScrapeRun(run.id, gaveUpReason(errorText(err)));
          result.runsFailed++;
        } else {
          // Keep the latest failure visible while it's retried on the next sweep.
          await db
            .update(schema.reviewScrapeRuns)
            .set({ errorMessage: errorText(err) })
            .where(eq(schema.reviewScrapeRuns.id, run.id));
          result.stillRunning++;
        }
      } catch (bookkeepingErr) {
        console.error(`[review-sweep] run ${run.id} bookkeeping:`, bookkeepingErr);
        result.stillRunning++;
      }
    }
  }

  return result;
}

/**
 * Whether an in-flight run should stop a new fetch from starting. Runs that
 * can't finish — no Apify run id, or unresolved past the timeout — are marked
 * failed here, so a dead run stops blocking.
 */
async function runStillBlocks(run: ScrapeRun): Promise<boolean> {
  if (!run.apifyRunId) {
    await failScrapeRun(run.id, NO_RUN_ID_REASON);
    return false;
  }
  if (!isScrapeRunStale(run)) return true;
  try {
    const { status, statusMessage } = await getRunStatus(run.apifyRunId);
    // Finished but not collected yet — the sweep still ingests it, so don't block.
    if (status === "SUCCEEDED") return false;
    await failScrapeRun(run.id, scrapeRunFailure(status, statusMessage, true) ?? gaveUpReason(`Apify status ${status}`));
  } catch (err) {
    await failScrapeRun(run.id, gaveUpReason(errorText(err)));
  }
  return false;
}

export type ReviewScrapeStartResult = {
  brands: number;
  started: number;
  skipped: number;
  /** Brands whose scrape couldn't be started, with the real reason (e.g. Apify's usage limit). */
  errors: Array<{ brand: string; error: string }>;
  /** Brands skipped because a fetch is already in flight. */
  inProgress: Array<{ brand: string; startedAt: Date; lastError: string | null }>;
  /** Set when one brand was requested but isn't set up for review fetching. */
  notConfigured: string | null;
};

/**
 * Start an async Google Maps reviews scrape for every brand with reviews
 * enabled + a Google Maps URL (or just `clientId`). Each run is recorded in
 * review_scrape_runs for the sweep. Skips a brand with a live in-flight run.
 */
export async function startReviewScrapes(opts: {
  clientId?: string | null;
  maxReviews: number;
}): Promise<ReviewScrapeStartResult> {
  const conditions = [eq(schema.brands.reviewsEnabled, true), isNotNull(schema.brands.googleMapsUrl)];
  if (opts.clientId) conditions.push(eq(schema.brands.id, opts.clientId));

  const activeBrands = (await db.select().from(schema.brands).where(and(...conditions))).filter(
    (b) => !!b.googleMapsUrl?.trim()
  );

  const result: ReviewScrapeStartResult = {
    brands: activeBrands.length,
    started: 0,
    skipped: 0,
    errors: [],
    inProgress: [],
    notConfigured: null,
  };

  if (opts.clientId && activeBrands.length === 0) {
    const [brand] = await db
      .select({ reviewsEnabled: schema.brands.reviewsEnabled })
      .from(schema.brands)
      .where(eq(schema.brands.id, opts.clientId))
      .limit(1);
    result.notConfigured = !brand
      ? "Brand not found."
      : !brand.reviewsEnabled
        ? "Review fetching isn't turned on for this brand."
        : "This brand has no Google Maps URL configured for reviews yet.";
    return result;
  }

  for (const brand of activeBrands) {
    try {
      const inFlight = await db
        .select()
        .from(schema.reviewScrapeRuns)
        .where(and(eq(schema.reviewScrapeRuns.clientId, brand.id), eq(schema.reviewScrapeRuns.status, "scraping")));

      const blocking: ScrapeRun[] = [];
      for (const run of inFlight) {
        if (await runStillBlocks(run)) blocking.push(run);
      }
      if (blocking.length > 0) {
        result.skipped++;
        result.inProgress.push({
          brand: brand.brandName,
          startedAt: blocking[0].startedAt,
          lastError: blocking.find((r) => r.errorMessage)?.errorMessage ?? null,
        });
        continue;
      }

      const { runId, datasetId } = await startReviewScrape({
        googleMapsUrl: (brand.googleMapsUrl as string).trim(),
        maxReviews: opts.maxReviews,
      });
      await db.insert(schema.reviewScrapeRuns).values({
        clientId: brand.id,
        apifyRunId: runId,
        apifyDatasetId: datasetId,
        status: "scraping",
      });
      result.started++;
    } catch (err) {
      result.errors.push({ brand: brand.brandName, error: errorText(err) });
    }
  }

  return result;
}

/** The brand's most recent scrape run (for reporting a fetch's outcome). */
export async function getLatestScrapeRun(clientId: string) {
  const [run] = await db
    .select({
      id: schema.reviewScrapeRuns.id,
      status: schema.reviewScrapeRuns.status,
      errorMessage: schema.reviewScrapeRuns.errorMessage,
      reviewsFound: schema.reviewScrapeRuns.reviewsFound,
      reviewsNew: schema.reviewScrapeRuns.reviewsNew,
      startedAt: schema.reviewScrapeRuns.startedAt,
      completedAt: schema.reviewScrapeRuns.completedAt,
    })
    .from(schema.reviewScrapeRuns)
    .where(eq(schema.reviewScrapeRuns.clientId, clientId))
    .orderBy(desc(schema.reviewScrapeRuns.startedAt))
    .limit(1);
  return run ?? null;
}
