import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  analyzeCharacterLikeness,
  applyRealismFilter,
  submitCharacterGeneration,
  extractPhysicalDescription,
  type CharacterMode,
} from "@/lib/video-generation/character-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/characters/generate
 *
 * Generate an AI character image from a source photo.
 * Pipeline: Claude Vision → Realism Filter → Kie AI NB2
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot generate characters" }, { status: 403 });
  }

  const body = await request.json();
  const { sourceImageUrl, name, mode = "likeness", clientId } = body as {
    sourceImageUrl: string;
    name: string;
    mode: CharacterMode;
    clientId: string;
  };

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  if (!sourceImageUrl) {
    return NextResponse.json({ error: "sourceImageUrl is required" }, { status: 400 });
  }
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Create character record in "generating" state with a placeholder image URL
  const [character] = await db
    .insert(schema.characters)
    .values({
      clientId,
      name: name.trim(),
      imageUrl: sourceImageUrl, // Temporary — will be replaced with generated image
      sourceImageUrl,
      status: "generating",
      description: `${mode === "identical" ? "Identical" : "Likeness"} — generating...`,
    })
    .returning();

  const characterId = character.id;

  try {
    // ── Step 1: Analyze likeness with Claude Vision ──
    let likenessJson: string;
    try {
      likenessJson = await analyzeCharacterLikeness(sourceImageUrl, mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[character-gen] Step 1 failed:", msg);
      await db.delete(schema.characters).where(eq(schema.characters.id, characterId));
      return NextResponse.json({ error: `Likeness analysis failed: ${msg}`, failedStep: 1 }, { status: 500 });
    }

    // Extract and save physical description from likeness analysis
    try {
      const physicalDescription = await extractPhysicalDescription(likenessJson);
      if (physicalDescription) {
        await db
          .update(schema.characters)
          .set({ description: physicalDescription, updatedAt: new Date() })
          .where(eq(schema.characters.id, characterId));
      }
    } catch {
      // Non-critical — continue even if description extraction fails
    }

    // ── Step 2: Apply realism filter ──
    let enhancedPrompt: string;
    try {
      enhancedPrompt = await applyRealismFilter(likenessJson, mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[character-gen] Step 2 failed:", msg);
      await db.delete(schema.characters).where(eq(schema.characters.id, characterId));
      return NextResponse.json({ error: `Realism filter failed: ${msg}`, failedStep: 2 }, { status: 500 });
    }

    // ── Step 3: Submit to Kie AI ──
    let kieTaskId: string;
    try {
      kieTaskId = await submitCharacterGeneration(enhancedPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[character-gen] Step 3 failed:", msg);
      await db.delete(schema.characters).where(eq(schema.characters.id, characterId));
      return NextResponse.json({ error: `Image generation failed: ${msg}`, failedStep: 3 }, { status: 500 });
    }

    await db
      .update(schema.characters)
      .set({
        kieTaskId,
        description: `${mode === "identical" ? "Identical" : "Likeness"} — generating image...`,
        updatedAt: new Date(),
      })
      .where(eq(schema.characters.id, characterId));

    return NextResponse.json({ characterId, kieTaskId });
  } catch (err) {
    await db.delete(schema.characters).where(eq(schema.characters.id, characterId));
    return NextResponse.json({ error: "Pipeline failed" }, { status: 500 });
  }
}
