import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { downloadFromR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * GET /api/reference-library/random?industry=beauty
 * Return one random active reference from the shared R2 manifest.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const industry = req.nextUrl.searchParams.get("industry");

  let items: Record<string, unknown>[] = [];
  try {
    const { buffer } = await downloadFromR2("shared/reference-ad-library/manifest.json");
    const manifest = JSON.parse(buffer.toString("utf-8"));
    items = (manifest.items || []).filter((item: Record<string, unknown>) => item.isActive !== false);
  } catch {
    return NextResponse.json({ error: "No references found" }, { status: 404 });
  }

  if (industry) {
    items = items.filter((item) => item.industry === industry);
  }

  if (items.length === 0) {
    return NextResponse.json({ error: "No references found" }, { status: 404 });
  }

  const ref = items[Math.floor(Math.random() * items.length)];
  return NextResponse.json({ ...ref, previewUrl: ref.imageUrl });
}
