import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { buildWinnerProfile, MIN_WINNERS_FOR_PROFILE } from "@/lib/qc/winners";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // one Claude vision call over up to 8 winner images

/**
 * POST /api/qc/winner-profile  { clientId }
 * Regenerate the past-winners profile from the client's current Winners Library.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;
  if (portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot regenerate the winner profile" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  try {
    const result = await buildWinnerProfile(clientId);
    return NextResponse.json({ ...result, minWinners: MIN_WINNERS_FOR_PROFILE });
  } catch (err) {
    console.error("[qc/winner-profile]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build the winner profile" },
      { status: 500 }
    );
  }
}
