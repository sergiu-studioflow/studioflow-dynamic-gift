import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { pickReferenceForClient } from "@/lib/static-ads/reference-selection";

export const dynamic = "force-dynamic";

/**
 * GET /api/reference-library/random?clientId=
 *
 * One random reference for a brand. Resolves the brand's own references first
 * and only falls back to the shared pool (narrowed by the client's allowed
 * industries) when it has none — see lib/static-ads/reference-selection.ts.
 *
 * `isShared` / `tier` are returned so the generator can tell the user their
 * brand is still running on shared creative rather than failing silently.
 *
 * Reads the database. It previously read an R2 manifest while every write went
 * to Postgres, which made uploads invisible and per-brand scoping impossible.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const clientId = req.nextUrl.searchParams.get("clientId");

  // Winners have their own picker (the "Winners" reference mode), so exclude
  // them here — otherwise the Auto mode would silently serve winners too.
  const picked = await pickReferenceForClient(clientId, { includeWinners: false });
  if (!picked) {
    return NextResponse.json({ error: "No references found" }, { status: 404 });
  }

  return NextResponse.json({
    name: picked.name,
    imageUrl: picked.imageUrl,
    previewUrl: picked.imageUrl,
    tier: picked.tier,
    isShared: picked.isShared,
  });
}
