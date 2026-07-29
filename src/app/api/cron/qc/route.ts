import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runGateCron } from "@/lib/qc/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/qc
 * Backstop for the Quality Control gate: grades a batch of queued reviews and reconciles
 * anything wedged. The UI pump (/api/qc/tick) is the happy path — this catches everything
 * generated while nobody had a tab open.
 *
 * Shared Neon compute → scheduled every 15 min in vercel.json. Never every 5 min: that
 * cadence blows the org's Neon compute quota (fleet lesson).
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorizedCron(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const graded = await runGateCron();
    return NextResponse.json({ ok: true, graded });
  } catch (err) {
    console.error("[cron/qc]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "qc cron failed" }, { status: 500 });
  }
}
