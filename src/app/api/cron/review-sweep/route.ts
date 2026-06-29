import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { getRunStatus, getDatasetItems, normalizeReview } from "@/lib/apify";
import { uploadToR2 } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { BRAND_SLUG } from "@/lib/static-ads/config";
import { sweepReviewGraphics, reconcileStuckParents } from "@/lib/reviews/poll-and-persist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PHOTOS_PER_REVIEW = 4;

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
async function ingestRun(run: typeof schema.reviewScrapeRuns.$inferSelect, datasetId: string) {
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

    // Archive customer photos for new reviews that qualify (>=4 stars + has photos)
    for (const row of inserted) {
      const imgs = Array.isArray(row.reviewImageUrls) ? (row.reviewImageUrls as string[]) : [];
      if ((row.stars ?? 0) >= 4 && imgs.length > 0) {
        const archived = await archivePhotos({
          externalReviewId: row.reviewId,
          clientId: run.clientId,
          imageUrls: imgs,
        });
        if (archived.length > 0) {
          await db
            .update(schema.reviews)
            .set({ archivedImageUrls: archived })
            .where(eq(schema.reviews.reviewId, row.reviewId));
        }
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
    })
    .where(eq(schema.reviewScrapeRuns.id, run.id));

  return { found: normalized.length, new: newCount };
}

/**
 * GET /api/cron/review-sweep
 *
 * 1) Polls in-flight Apify scrape runs; ingests reviews + archives photos when done.
 * 2) Polls generating review-graphic Kie jobs; persists to R2 + reconciles parents.
 * Cheap no-op when there's nothing in flight. Also callable from the gallery.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorizedCron(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inFlight = await db
    .select()
    .from(schema.reviewScrapeRuns)
    .where(eq(schema.reviewScrapeRuns.status, "scraping"));

  let runsCompleted = 0;
  let runsFailed = 0;
  let reviewsNew = 0;
  let stillRunning = 0;

  for (const run of inFlight) {
    if (!run.apifyRunId) continue;
    try {
      const { status, datasetId } = await getRunStatus(run.apifyRunId);
      if (status === "SUCCEEDED") {
        const ds = datasetId || run.apifyDatasetId;
        if (!ds) {
          await db
            .update(schema.reviewScrapeRuns)
            .set({ status: "error", errorMessage: "No dataset id", completedAt: new Date() })
            .where(eq(schema.reviewScrapeRuns.id, run.id));
          runsFailed++;
          continue;
        }
        const r = await ingestRun(run, ds);
        reviewsNew += r.new;
        runsCompleted++;
      } else if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        await db
          .update(schema.reviewScrapeRuns)
          .set({ status: "error", errorMessage: `Apify run ${status}`, completedAt: new Date() })
          .where(eq(schema.reviewScrapeRuns.id, run.id));
        runsFailed++;
      } else {
        stillRunning++;
      }
    } catch (err) {
      console.error(`[review-sweep] run ${run.id}:`, err);
      stillRunning++;
    }
  }

  // Also progress any in-flight graphic generations
  let graphics = { swept: 0 };
  try {
    graphics = await sweepReviewGraphics({});
    await reconcileStuckParents();
  } catch (err) {
    console.error("[review-sweep] graphics sweep:", err);
  }

  return NextResponse.json({
    scrapeRuns: inFlight.length,
    runsCompleted,
    runsFailed,
    stillRunning,
    reviewsNew,
    graphicsSwept: graphics.swept,
  });
}
