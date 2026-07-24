import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runPublisher } from "@/lib/posting/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/publish-posts
 * Runs the whole publisher cycle (resume IG containers → sweep stuck →
 * claim due → publish → roll parents up). Scheduled every 10 minutes.
 * `?dryRun=1` exercises the claim/sweep logic without touching Meta or the queue.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorizedCron(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const result = await runPublisher({ dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/publish-posts]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Publisher run failed" },
      { status: 500 }
    );
  }
}
