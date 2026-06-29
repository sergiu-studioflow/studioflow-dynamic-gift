import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { startReviewScrape } from "@/lib/apify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/review-ingest
 *
 * Starts an async Google Maps reviews scrape for every brand that has
 * reviews enabled + a Google Maps URL. Records each run in review_scrape_runs;
 * the review-sweep cron polls the runs and ingests the results. Skips a brand
 * that already has an in-flight run (avoids stacking). Daily cadence.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorizedCron(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const maxReviews = Math.min(
    parseInt(req.nextUrl.searchParams.get("maxReviews") || "100", 10) || 100,
    500
  );
  const onlyClientId = req.nextUrl.searchParams.get("clientId");

  const conditions = [
    eq(schema.brands.reviewsEnabled, true),
    isNotNull(schema.brands.googleMapsUrl),
  ];
  if (onlyClientId) conditions.push(eq(schema.brands.id, onlyClientId));

  const activeBrands = await db
    .select()
    .from(schema.brands)
    .where(and(...conditions));

  let started = 0;
  let skipped = 0;
  const errors: Array<{ brand: string; error: string }> = [];

  for (const brand of activeBrands) {
    // Skip if there's already an in-flight run for this brand
    const [inFlight] = await db
      .select({ id: schema.reviewScrapeRuns.id })
      .from(schema.reviewScrapeRuns)
      .where(
        and(
          eq(schema.reviewScrapeRuns.clientId, brand.id),
          eq(schema.reviewScrapeRuns.status, "scraping")
        )
      )
      .limit(1);
    if (inFlight) {
      skipped++;
      continue;
    }

    try {
      const { runId, datasetId } = await startReviewScrape({
        googleMapsUrl: brand.googleMapsUrl as string,
        maxReviews,
      });
      await db.insert(schema.reviewScrapeRuns).values({
        clientId: brand.id,
        apifyRunId: runId,
        apifyDatasetId: datasetId,
        status: "scraping",
      });
      started++;
    } catch (err) {
      errors.push({
        brand: brand.brandName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    brands: activeBrands.length,
    started,
    skipped,
    errors,
  });
}
