import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { toAccessibleUrl } from "@/lib/r2";
import { advanceGeneratingCharacter } from "@/lib/video-generation/character-status";

export const dynamic = "force-dynamic";

/**
 * GET /api/characters/generate/[id]
 *
 * Poll for character image generation status.
 * When Kie AI completes, downloads image → uploads to R2 → updates character.
 * A job that failed or was abandoned marks the character `error` with its message.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;

  const [found] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, id));

  if (!found) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  let character = found;
  if (character.status === "generating") {
    try {
      character = await advanceGeneratingCharacter(character);
    } catch (err) {
      console.error(`[characters/generate/${id}]`, err);
    }
  }

  if (character.status === "ready") {
    const imagePreviewUrl = await toAccessibleUrl(character.imageUrl);
    return NextResponse.json({ ...character, imagePreviewUrl });
  }

  if (character.status === "error") {
    return NextResponse.json({
      ...character,
      errorMessage: character.errorMessage || "Image generation failed",
    });
  }

  return NextResponse.json(character);
}
