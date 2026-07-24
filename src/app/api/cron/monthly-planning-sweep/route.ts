import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runMonthlyPlanning } from "@/lib/monthly-planning/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/monthly-planning-sweep
 * Steps every active monthly plan: generate briefs → produce static → poll →
 * schedule completed into the posting queue. Runs every 15 min (Neon quota).
 * ?dryRun=1 exercises the loop without Claude/Kie calls or DB writes.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorizedCron(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const result = await runMonthlyPlanning({ dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/monthly-planning-sweep]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Run failed" }, { status: 500 });
  }
}
