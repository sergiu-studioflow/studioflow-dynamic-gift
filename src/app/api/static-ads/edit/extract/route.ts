import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractTextElements, formatForEditing } from "@/lib/static-ads/edit-pipeline";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/static-ads/edit/extract
 *
 * Runs Agent 1 (text extraction) + Agent 2 (human-friendly formatting).
 * Input: { generationId }
 * Output: { analysisJson, textElements, imageUrl }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  let body: { generationId: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { generationId } = body;
  if (!generationId) {
    return NextResponse.json({ error: "generationId is required" }, { status: 400 });
  }

  // Fetch the generation record
  const [generation] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, generationId))
    .limit(1);

  if (!generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  if (generation.status !== "completed" || !generation.imageUrl) {
    return NextResponse.json({ error: "Generation must be completed with an image" }, { status: 400 });
  }

  try {
    // Agent 1: Extract text elements from the image
    const analysisJson = await extractTextElements(generation.imageUrl);

    // Agent 2: Format into human-friendly editable list
    const textElements = await formatForEditing(analysisJson);

    // Get presigned URL for the image preview
    const imageUrl = await toAccessibleUrl(generation.imageUrl);

    return NextResponse.json({
      analysisJson,
      textElements,
      imageUrl,
    });
  } catch (err) {
    console.error("[static-ads/edit/extract]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 500 }
    );
  }
}
