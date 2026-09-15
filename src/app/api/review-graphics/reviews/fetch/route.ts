import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getLatestScrapeRun, startReviewScrapes, sweepScrapeRuns } from "@/lib/reviews/scrape-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/review-graphics/reviews/fetch
 * Body: { clientId }
 *
 * "Pull latest reviews" for one brand: starts a Google Maps review scrape.
 * Returns { started, skipped, errors, inProgress, notConfigured } so the UI can
 * say exactly what happened (e.g. Apify's usage limit, no Google Maps URL).
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  if (authResult.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : null;
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await startReviewScrapes({ clientId, maxReviews: 100 }));
  } catch (err) {
    console.error("[review-graphics/reviews/fetch] start", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start the review fetch" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/review-graphics/reviews/fetch?clientId=
 *
 * Progresses the brand's in-flight scrape (ingesting it once Apify finishes, or
 * failing it with the reason) and reports { stillRunning, latestRun }. Polled by
 * the Reviews tab after a pull, so new reviews land while the page is open
 * instead of waiting for the scheduled sweep.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  if (authResult.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    const runs = await sweepScrapeRuns({ clientId });
    return NextResponse.json({
      stillRunning: runs.stillRunning,
      reviewsNew: runs.reviewsNew,
      latestRun: await getLatestScrapeRun(clientId),
    });
  } catch (err) {
    console.error("[review-graphics/reviews/fetch] sweep", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to check the review fetch" },
      { status: 500 }
    );
  }
}
