import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { downloadFromR2, uploadToR2, r2KeyFromUrl } from "@/lib/r2";
import { v4 as uuid } from "uuid";
import { r2Prefix } from "@/lib/static-ads/config";

export const dynamic = "force-dynamic";

/**
 * POST /api/winners/save-from-research
 * Save a competitor ad image to the Winners Library.
 * Body: { imageUrl, name?, brandName?, tags? }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  const body = await req.json();
  const { imageUrl, name, brandName, tags } = body;

  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
  }

  const r2Key = r2KeyFromUrl(imageUrl);
  if (!r2Key) {
    return NextResponse.json({ error: "Image URL is not from a recognized R2 source" }, { status: 400 });
  }

  const { buffer, contentType } = await downloadFromR2(r2Key);

  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpeg";
  const winnersKey = `${r2Prefix("winners-library")}/${uuid()}.${ext}`;
  const winnerImageUrl = await uploadToR2(winnersKey, buffer, contentType);

  const winnerName = name || `${brandName || "Competitor"} - Ad`;
  const [winner] = await db
    .insert(schema.winnersLibrary)
    .values({
      userId: portalUser.id,
      name: winnerName,
      imageUrl: winnerImageUrl,
      productName: brandName || null,
      tags: tags || null,
    })
    .returning();

  return NextResponse.json(winner, { status: 201 });
}
