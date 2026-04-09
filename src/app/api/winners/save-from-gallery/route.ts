import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { downloadFromR2, uploadToR2, r2KeyFromUrl } from "@/lib/r2";
import { v4 as uuid } from "uuid";
import { r2Prefix } from "@/lib/static-ads/config";

export const dynamic = "force-dynamic";

/**
 * POST /api/winners/save-from-gallery
 * Save a completed generation to the Winners Library.
 * Body: { generationId, name?, tags? }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  const body = await req.json();
  const { generationId, name, tags } = body;

  if (!generationId) {
    return NextResponse.json({ error: "generationId is required" }, { status: 400 });
  }

  // Fetch the generation
  const [generation] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, generationId))
    .limit(1);

  if (!generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  if (generation.status !== "completed" || !generation.imageUrl) {
    return NextResponse.json({ error: "Generation is not completed or has no image" }, { status: 400 });
  }

  // Download image from the generation's R2 URL
  const r2Key = r2KeyFromUrl(generation.imageUrl);
  if (!r2Key) {
    return NextResponse.json({ error: "Cannot resolve image URL" }, { status: 400 });
  }

  const { buffer, contentType } = await downloadFromR2(r2Key);

  // Re-upload to winners library path
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpeg";
  const winnersKey = `${r2Prefix("winners-library")}/${uuid()}.${ext}`;
  const imageUrl = await uploadToR2(winnersKey, buffer, contentType);

  // Insert into winners_library
  const winnerName = name || `${generation.styleName || "Custom"} - ${generation.productName || "Ad"}`;
  const [winner] = await db
    .insert(schema.winnersLibrary)
    .values({
      userId: portalUser.id,
      name: winnerName,
      imageUrl,
      sourceGenerationId: generation.id,
      productName: generation.productName,
      tags: tags || null,
    })
    .returning();

  return NextResponse.json(winner, { status: 201 });
}
