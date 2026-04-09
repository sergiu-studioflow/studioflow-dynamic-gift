import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { pollKieJob } from "@/lib/static-ads/kie-ai";
import { uploadToR2, r2Key, toAccessibleUrl } from "@/lib/r2";
import { BRAND_SLUG } from "@/lib/static-ads/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Add presigned URLs to a generation record for frontend display */
async function withPresignedUrls<T extends { imageUrl?: string | null; thumbnailUrl?: string | null }>(
  gen: T
): Promise<T> {
  return {
    ...gen,
    imageUrl: gen.imageUrl ? await toAccessibleUrl(gen.imageUrl) : gen.imageUrl,
    thumbnailUrl: gen.thumbnailUrl ? await toAccessibleUrl(gen.thumbnailUrl) : gen.thumbnailUrl,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [generation] = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.id, id))
      .limit(1);

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }

    // If errored, return current state
    if (generation.status === "error") {
      return NextResponse.json(generation);
    }

    // If completed but still on temp URL, persist to R2
    if (
      generation.status === "completed" &&
      generation.imageUrl &&
      !generation.imageUrl.includes("r2.dev") &&
      !generation.imageUrl.includes("studio-flow.co")
    ) {
      try {
        const r2Url = await downloadAndUploadToR2(generation.imageUrl, generation.id);
        const [updated] = await db
          .update(schema.staticAdGenerations)
          .set({ imageUrl: r2Url, updatedAt: new Date() })
          .where(eq(schema.staticAdGenerations.id, generation.id))
          .returning();
        console.log(`[static-ads/r2] Persisted ${generation.id} to R2`);
        return NextResponse.json(await withPresignedUrls(updated));
      } catch (err) {
        console.error(`[static-ads/r2] Failed to persist ${generation.id}:`, err);
        // Still return the temp URL — next poll will retry
        return NextResponse.json(generation);
      }
    }

    // If completed with R2 URL, return with presigned URL
    if (generation.status === "completed") {
      return NextResponse.json(await withPresignedUrls(generation));
    }

    // If generating and has a Kie job ID, poll for status
    if (generation.status === "generating" && generation.kieJobId) {
      try {
        const result = await pollKieJob(generation.kieJobId);

        if (result.state === "success" && result.resultUrls.length > 0) {
          const sourceUrl = result.resultUrls[0];

          // Save with temp URL first — R2 persistence happens on the next poll
          const [updated] = await db
            .update(schema.staticAdGenerations)
            .set({
              status: "completed",
              imageUrl: sourceUrl,
              updatedAt: new Date(),
            })
            .where(eq(schema.staticAdGenerations.id, generation.id))
            .returning();

          return NextResponse.json(await withPresignedUrls(updated));
        }

        if (result.state === "failed") {
          const [updated] = await db
            .update(schema.staticAdGenerations)
            .set({
              status: "error",
              errorMessage: result.errorMessage || "Generation failed",
              updatedAt: new Date(),
            })
            .where(eq(schema.staticAdGenerations.id, generation.id))
            .returning();

          return NextResponse.json(updated);
        }

        // Still processing — return current state
        return NextResponse.json({
          ...generation,
          kieState: result.state,
        });
      } catch (pollErr) {
        console.error("[static-ads/poll] Poll error:", pollErr);
        // Transient poll error — don't mark as failed, just return current state
        return NextResponse.json(generation);
      }
    }

    return NextResponse.json(generation);
  } catch (err) {
    console.error("[static-ads/generate/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

async function downloadAndUploadToR2(sourceUrl: string, generationId: string): Promise<string> {
  // Retry up to 3 times
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/png";
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      const key = r2Key(BRAND_SLUG, "static-ad-system/generated-ads", `${generationId}.${ext}`);

      return await uploadToR2(key, buffer, contentType);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("Download failed after 3 attempts");
}
