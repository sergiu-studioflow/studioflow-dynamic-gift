import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { runGateTick } from "@/lib/qc/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/qc/tick
 * The UI pump. Galleries and the QC dashboard call this on an interval while anything is
 * still grading, so a verdict lands within seconds of generation finishing instead of
 * waiting for the 15-minute cron.
 */
export async function POST() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  // Grading spends model credits — read-only accounts don't drive it.
  if (authResult.portalUser.role === "viewer") {
    return NextResponse.json({ graded: 0, error: "Viewers cannot run grading" }, { status: 403 });
  }

  try {
    const graded = await runGateTick();
    return NextResponse.json({ graded });
  } catch (err) {
    console.error("[qc/tick]", err);
    return NextResponse.json({ graded: 0, error: err instanceof Error ? err.message : "tick failed" }, { status: 500 });
  }
}
