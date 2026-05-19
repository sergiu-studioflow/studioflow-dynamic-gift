import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { pollKieJob } from "@/lib/static-ads/kie-ai";
import { uploadToR2 } from "@/lib/r2";
import { BRAND_SLUG } from "@/lib/static-ads/config";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export type Generation = typeof schema.staticAdGenerations.$inferSelect;

/**
 * Poll Kie for a single row and persist the result eagerly:
 *   - generating + has kieJobId → poll; on success, download + upload to R2, then mark completed
 *   - completed + on tempfile → backfill to R2
 *   - completed + on R2 OR error OR no kieJobId → return as-is
 *
 * Safe to call from any context (gallery sweep, single-row poll, cron).
 * Idempotent per row.
 */
export async function pollAndPersistGeneration(gen: Generation): Promise<Generation> {
  if (gen.status === "error") return gen;

  if (
    gen.status === "completed" &&
    gen.imageUrl &&
    !isR2Url(gen.imageUrl) &&
    !gen.imageUrl.includes("studio-flow.co")
  ) {
    return await persistToR2(gen, gen.imageUrl);
  }

  if (gen.status === "completed") return gen;

  if (gen.status === "generating" && gen.kieJobId) {
    let result;
    try {
      result = await pollKieJob(gen.kieJobId);
    } catch (err) {
      console.error(`[static-ads/poll] Kie poll failed for ${gen.id}:`, err);
      return gen;
    }

    if (result.state === "success" && result.resultUrls.length > 0) {
      return await persistToR2(gen, result.resultUrls[0]);
    }

    if (result.state === "failed") {
      const [updated] = await db
        .update(schema.staticAdGenerations)
        .set({
          status: "error",
          errorMessage: result.errorMessage || "Generation failed",
          updatedAt: new Date(),
        })
        .where(eq(schema.staticAdGenerations.id, gen.id))
        .returning();
      return updated;
    }
  }

  return gen;
}

async function persistToR2(gen: Generation, sourceUrl: string): Promise<Generation> {
  let finalUrl = sourceUrl;
  try {
    finalUrl = await downloadAndUploadToR2(sourceUrl, gen.id, gen.clientId);
  } catch (err) {
    console.error(`[static-ads/r2] eager persist failed for ${gen.id}, keeping temp URL:`, err);
  }

  const [updated] = await db
    .update(schema.staticAdGenerations)
    .set({ status: "completed", imageUrl: finalUrl, updatedAt: new Date() })
    .where(eq(schema.staticAdGenerations.id, gen.id))
    .returning();
  return updated;
}

function isR2Url(url: string): boolean {
  return url.includes("r2.dev") || url.includes("r2.cloudflarestorage.com");
}

async function downloadAndUploadToR2(
  sourceUrl: string,
  generationId: string,
  clientId: string | null
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/png";
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      const clientPrefix = clientId ? await getClientStoragePrefix(clientId) : null;
      const basePrefix = clientPrefix || `brands/${BRAND_SLUG}`;
      const key = `${basePrefix}/static-ad-system/generated-ads/${generationId}.${ext}`;
      return await uploadToR2(key, buffer, contentType);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Download failed after 3 attempts");
}

/**
 * Sweep all currently-generating rows for a client (or globally if clientId
 * is null/undefined), running poll+persist for each in parallel with a per-row
 * timeout. Returns when all polls have settled or timed out. Errors are
 * swallowed — stuck rows simply remain on their current state until the next sweep.
 */
export async function sweepGeneratingRows(opts: {
  clientId?: string | null;
  perRowTimeoutMs?: number;
}): Promise<void> {
  const timeoutMs = opts.perRowTimeoutMs ?? 5000;

  const rows = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.status, "generating"));

  const candidates = rows.filter(
    (r) => !!r.kieJobId && (opts.clientId == null || r.clientId === opts.clientId)
  );
  if (candidates.length === 0) return;

  await Promise.allSettled(
    candidates.map((row) =>
      Promise.race([
        pollAndPersistGeneration(row),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`sweep timeout for ${row.id}`)), timeoutMs)
        ),
      ]).catch((err) => {
        console.error(`[static-ads/sweep] ${row.id}:`, err);
      })
    )
  );
}
