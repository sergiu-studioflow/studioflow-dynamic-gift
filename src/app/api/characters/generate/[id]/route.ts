import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { pollKieJob } from "@/lib/static-ads/kie-ai";
import { uploadToR2, r2Key, toAccessibleUrl } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/characters/generate/[id]
 *
 * Poll for character image generation status.
 * When Kie AI completes, downloads image → uploads to R2 → updates character.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;

  const [character] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, id));

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  // Already completed
  if (character.status === "ready") {
    const imagePreviewUrl = await toAccessibleUrl(character.imageUrl);
    return NextResponse.json({ ...character, imagePreviewUrl });
  }

  // Error state
  if (character.status === "error") {
    return NextResponse.json(character);
  }

  // Still generating — poll Kie AI
  if (character.status === "generating" && character.kieTaskId) {
    try {
      const result = await pollKieJob(character.kieTaskId);

      if (result.state === "success" && result.resultUrls?.length) {
        // Download and persist to R2
        const sourceUrl = result.resultUrls[0];
        let finalImageUrl = sourceUrl;

        try {
          const imgRes = await fetch(sourceUrl);
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            const contentType = imgRes.headers.get("content-type") || "image/png";
            const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
            const prefix = await getClientStoragePrefix(character.clientId) || "web-profits";
            const key = r2Key(prefix, "video-generation/characters", `${character.id}.${ext}`);
            finalImageUrl = await uploadToR2(key, buffer, contentType);
          }
        } catch {
          // Keep Kie URL if R2 upload fails
        }

        await db
          .update(schema.characters)
          .set({
            imageUrl: finalImageUrl,
            status: "ready",
            description: character.description?.replace(" — generating image...", "").replace(" — generating...", "") || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.characters.id, id));

        const imagePreviewUrl = await toAccessibleUrl(finalImageUrl);
        return NextResponse.json({
          ...character,
          imageUrl: finalImageUrl,
          imagePreviewUrl,
          status: "ready",
        });
      }

      if (result.state === "failed") {
        await db.delete(schema.characters).where(eq(schema.characters.id, id));

        return NextResponse.json({
          status: "error",
          errorMessage: result.errorMessage || "Image generation failed",
        });
      }

      // Still processing
      return NextResponse.json({ ...character, kieState: result.state });
    } catch {
      return NextResponse.json(character);
    }
  }

  return NextResponse.json(character);
}
