import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { startReviewScrapes } from "@/lib/reviews/scrape-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/review-ingest
 *
 * Starts an async Google Maps reviews scrape for every brand that has
 * reviews enabled + a Google Maps URL. Records each run in review_scrape_runs;
 * the review-sweep cron polls the runs and ingests the results. Skips a brand
 * that already has a live in-flight run (avoids stacking); runs with no Apify
 * id or stuck past the 2-hour timeout are failed instead of blocking. Daily
 * cadence. The Reviews tab's "Pull latest reviews" uses
 * /api/review-graphics/reviews/fetch (cron routes are admin-only).
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

  const result = await startReviewScrapes({ clientId: onlyClientId, maxReviews });
  return NextResponse.json(result);
}
