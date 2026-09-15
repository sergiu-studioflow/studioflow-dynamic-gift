/**
 * Progress a character stuck in `generating`: poll its Kie image job, persist the result
 * to R2 and mark it ready — or fail it once it is clearly abandoned. Shared by the
 * single-character poll (GET /api/characters/generate/[id]) and the library listing
 * (GET /api/characters), so a character finishes even when nobody watches the form.
 */

import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { pollKieJob } from "@/lib/static-ads/kie-ai";
import { uploadToR2 } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export type CharacterRow = typeof schema.characters.$inferSelect;

/** POST /api/characters/generate can run 300s before the image job exists. */
const SUBMIT_ABANDON_MS = 10 * 60 * 1000;
/** A 1K Nano Banana render takes about a minute; an hour means the job is lost. */
const RENDER_ABANDON_MS = 60 * 60 * 1000;

export async function advanceGeneratingCharacter(character: CharacterRow): Promise<CharacterRow> {
  if (character.status !== "generating") return character;
  const ageMs = Date.now() - new Date(character.createdAt).getTime();

  if (!character.kieTaskId) {
    if (ageMs < SUBMIT_ABANDON_MS) return character;
    return markCharacterError(
      character,
      "Character generation stopped before the image was requested — please try again."
    );
  }

  let result: Awaited<ReturnType<typeof pollKieJob>>;
  try {
    result = await pollKieJob(character.kieTaskId);
  } catch (err) {
    // Transient — the next poll retries.
    console.warn(`[characters] Kie poll failed for ${character.id}:`, err instanceof Error ? err.message : err);
    return character;
  }

  if (result.state === "success" && result.resultUrls.length > 0) {
    const sourceUrl = result.resultUrls[0];
    let finalImageUrl = sourceUrl;
    try {
      const imgRes = await fetch(sourceUrl);
      if (imgRes.ok) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get("content-type") || "image/png";
        const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
        const clientPrefix = await getClientStoragePrefix(character.clientId);
        const prefix = clientPrefix || `brands/${process.env.BRAND_SLUG || "dynamic-gift"}`;
        const key = `${prefix}/video-generation/characters/${character.id}.${ext}`;
        finalImageUrl = await uploadToR2(key, buffer, contentType);
      }
    } catch {
      // Keep Kie URL if R2 upload fails
    }

    const [updated] = await db
      .update(schema.characters)
      .set({
        imageUrl: finalImageUrl,
        status: "ready",
        description:
          character.description?.replace(" — generating image...", "").replace(" — generating...", "") || null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.characters.id, character.id), eq(schema.characters.status, "generating")))
      .returning();
    return updated ?? latestCharacter(character);
  }

  if (result.state === "failed") {
    return markCharacterError(character, result.errorMessage || "Image generation failed");
  }

  if (ageMs > RENDER_ABANDON_MS) {
    return markCharacterError(character, "The image job didn't finish within an hour — please try again.");
  }
  return character;
}

async function markCharacterError(character: CharacterRow, message: string): Promise<CharacterRow> {
  const [updated] = await db
    .update(schema.characters)
    .set({ status: "error", errorMessage: message, updatedAt: new Date() })
    .where(and(eq(schema.characters.id, character.id), eq(schema.characters.status, "generating")))
    .returning();
  return updated ?? latestCharacter(character);
}

async function latestCharacter(character: CharacterRow): Promise<CharacterRow> {
  const [latest] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, character.id))
    .limit(1);
  return latest ?? character;
}
