import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { listVoices, syncVoices } from "@/lib/video-generation/voices";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // a sync downloads and re-hosts every preview clip

/**
 * GET /api/video-generation/voices — voices for the Video Generation picker. Read-only: syncing
 * (≈60 downloads + R2 uploads) runs only on an admin's POST, never on a page load.
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const voices = await listVoices();
  const syncError = voices.length === 0 ? "No voices loaded yet — an admin can load them with Refresh." : null;
  return NextResponse.json({ voices, syncError });
}

/** POST /api/video-generation/voices — re-sync from ElevenLabs (admin), e.g. after adding voices there. */
export async function POST() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  try {
    const result = await syncVoices();
    return NextResponse.json({ ...result, voices: await listVoices() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 502 });
  }
}
