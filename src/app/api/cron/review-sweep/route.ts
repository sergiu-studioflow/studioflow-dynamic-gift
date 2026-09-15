import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sweepReviewGraphics, reconcileStuckParents } from "@/lib/reviews/poll-and-persist";
import { sweepScrapeRuns } from "@/lib/reviews/scrape-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/review-sweep
 *
 * 1) Polls in-flight Apify scrape runs; ingests reviews + archives photos when done.
 *    Runs that can't finish (no Apify run id, failed on Apify, or unresolved after
 *    the 2-hour timeout) are marked `error` with the reason.
 * 2) Polls generating review-graphic Kie jobs; persists to R2 + reconciles parents.
 * Cheap no-op when there's nothing in flight.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorizedCron(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runs = await sweepScrapeRuns();

  // Also progress any in-flight graphic generations
  let graphics = { swept: 0 };
  try {
    graphics = await sweepReviewGraphics({});
    await reconcileStuckParents();
  } catch (err) {
    console.error("[review-sweep] graphics sweep:", err);
  }

  return NextResponse.json({
    ...runs,
    graphicsSwept: graphics.swept,
  });
}
