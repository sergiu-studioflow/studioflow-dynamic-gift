/**
 * Poll Kie for review graphic assets and persist results to R2 eagerly.
 * Mirrors the static-ad poll-and-persist pattern: a generating asset with a
 * kieJobId is polled; on success the image is downloaded and uploaded to R2
 * (before the row flips to "completed", to avoid Kie tempfile orphans).
 *
 * After an asset settles, the parent review_graphics row is reconciled:
 *   - any asset still generating  → parent stays "generating"
 *   - else at least one completed → parent "draft" (ready for approval)
 *   - else (all errored)          → parent "error"
 */

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { pollKieJob } from "@/lib/static-ads/kie-ai";
import { uploadToR2 } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { BRAND_SLUG } from "@/lib/static-ads/config";

type Asset = typeof schema.reviewGraphicAssets.$inferSelect;

async function persistAssetToR2(asset: Asset, sourceUrl: string, clientId: string | null): Promise<void> {
  let finalUrl = sourceUrl;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") || "image/png";
        const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
        const clientPrefix = clientId ? await getClientStoragePrefix(clientId) : null;
        const basePrefix = clientPrefix || `brands/${BRAND_SLUG}`;
        const key = `${basePrefix}/review-system/graphics/${asset.id}.${ext}`;
        finalUrl = await uploadToR2(key, buffer, contentType);
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  } catch (err) {
    console.error(`[reviews/r2] eager persist failed for asset ${asset.id}, keeping temp URL:`, err);
  }

  await db
    .update(schema.reviewGraphicAssets)
    .set({ status: "completed", imageUrl: finalUrl, updatedAt: new Date() })
    .where(eq(schema.reviewGraphicAssets.id, asset.id));
}

/** Poll + persist a single asset. Idempotent. */
export async function pollAndPersistAsset(asset: Asset, clientId: string | null): Promise<void> {
  if (asset.status !== "generating" || !asset.kieJobId) return;

  let result;
  try {
    result = await pollKieJob(asset.kieJobId);
  } catch (err) {
    console.error(`[reviews/poll] Kie poll failed for asset ${asset.id}:`, err);
    return;
  }

  if (result.state === "success" && result.resultUrls.length > 0) {
    await persistAssetToR2(asset, result.resultUrls[0], clientId);
  } else if (result.state === "failed") {
    await db
      .update(schema.reviewGraphicAssets)
      .set({ status: "error", errorMessage: result.errorMessage || "Generation failed", updatedAt: new Date() })
      .where(eq(schema.reviewGraphicAssets.id, asset.id));
  }
}

/** Reconcile the parent review_graphics status from its assets. */
async function reconcileParent(graphicId: string): Promise<void> {
  const assets = await db
    .select()
    .from(schema.reviewGraphicAssets)
    .where(eq(schema.reviewGraphicAssets.graphicId, graphicId));

  if (assets.some((a) => a.status === "generating")) return; // not done yet

  const [parent] = await db
    .select({ status: schema.reviewGraphics.status })
    .from(schema.reviewGraphics)
    .where(eq(schema.reviewGraphics.id, graphicId))
    .limit(1);
  // Don't override a human decision (approved/rejected)
  if (!parent || parent.status === "approved" || parent.status === "rejected") return;

  const anyCompleted = assets.some((a) => a.status === "completed");
  await db
    .update(schema.reviewGraphics)
    .set({ status: anyCompleted ? "draft" : "error", updatedAt: new Date() })
    .where(eq(schema.reviewGraphics.id, graphicId));
}

/**
 * Sweep generating assets (optionally scoped to a client or a single graphic),
 * persisting completions and reconciling parents. Errors are swallowed per-asset.
 */
export async function sweepReviewGraphics(opts: {
  clientId?: string | null;
  graphicId?: string | null;
  perRowTimeoutMs?: number;
}): Promise<{ swept: number }> {
  const timeoutMs = opts.perRowTimeoutMs ?? 8000;

  // Find generating assets, resolving their parent's clientId.
  const rows = await db
    .select({
      asset: schema.reviewGraphicAssets,
      clientId: schema.reviewGraphics.clientId,
      parentStatus: schema.reviewGraphics.status,
    })
    .from(schema.reviewGraphicAssets)
    .innerJoin(schema.reviewGraphics, eq(schema.reviewGraphicAssets.graphicId, schema.reviewGraphics.id))
    .where(eq(schema.reviewGraphicAssets.status, "generating"));

  const candidates = rows.filter(
    (r) =>
      !!r.asset.kieJobId &&
      (opts.clientId == null || r.clientId === opts.clientId) &&
      (opts.graphicId == null || r.asset.graphicId === opts.graphicId)
  );
  if (candidates.length === 0) return { swept: 0 };

  await Promise.allSettled(
    candidates.map((r) =>
      Promise.race([
        pollAndPersistAsset(r.asset, r.clientId),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`sweep timeout ${r.asset.id}`)), timeoutMs)),
      ]).catch((err) => console.error(`[reviews/sweep] ${r.asset.id}:`, err))
    )
  );

  // Reconcile each affected parent
  const parentIds = Array.from(new Set(candidates.map((r) => r.asset.graphicId)));
  for (const pid of parentIds) {
    try {
      await reconcileParent(pid);
    } catch (err) {
      console.error(`[reviews/sweep] reconcile ${pid}:`, err);
    }
  }

  return { swept: candidates.length };
}

/**
 * Also reconcile any parents stuck on "generating" whose assets have all
 * settled (covers the case where assets finished in a prior sweep but the
 * parent wasn't reconciled — e.g. transient error). Cheap, no Kie calls.
 */
export async function reconcileStuckParents(clientId?: string | null): Promise<void> {
  const conditions = [eq(schema.reviewGraphics.status, "generating")];
  if (clientId) conditions.push(eq(schema.reviewGraphics.clientId, clientId));
  const parents = await db
    .select({ id: schema.reviewGraphics.id })
    .from(schema.reviewGraphics)
    .where(and(...conditions));
  for (const p of parents) {
    await reconcileParent(p.id);
  }
}
