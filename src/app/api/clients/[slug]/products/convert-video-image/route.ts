import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { resolveClientId } from "@/lib/client-api-helpers";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { downloadFromR2, uploadToR2, r2KeyFromUrl } from "@/lib/r2";
import sharp from "sharp";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Target: 9:16 portrait (1080x1920)
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;

// Each call converts a bounded batch and reports the rest as `remaining`, so a brand
// with many products never runs into maxDuration mid-image. The client re-posts
// `remaining` until it is empty.
const MAX_PER_CALL = 10;
const TIME_BUDGET_MS = 35_000;
const SOURCE_FETCH_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { id: string; name: string; status: "converted" | "skipped" | "error"; videoImageUrl?: string; error?: string };

/**
 * POST /api/clients/[slug]/products/convert-video-image
 *
 * Takes products' existing imageUrl, resizes/pads to 9:16,
 * uploads to R2 under the brand's own storage prefix, and saves as videoImageUrl.
 *
 * Body: { productIds: string[] }
 * Response: { total, converted, skipped, errors, results, remaining: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot modify products" }, { status: 403 });
  }

  const clientId = await resolveClientId((await params).slug);
  if (!clientId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) ?? {};
  const requested: unknown[] = Array.isArray(body.productIds) ? body.productIds : body.productId ? [body.productId] : [];
  const productIds = [...new Set(requested.filter((id): id is string => typeof id === "string" && !!id))];

  if (productIds.length === 0) {
    return NextResponse.json({ error: "No product IDs provided" }, { status: 400 });
  }

  // Converted images go under this brand's own prefix. Never fall back to another
  // namespace — a brand without a prefix has to be fixed, not written elsewhere.
  const storagePrefix = (await getClientStoragePrefix(clientId))?.replace(/\/+$/, "");
  if (!storagePrefix) {
    return NextResponse.json(
      { error: "This brand has no storage prefix configured, so converted images have nowhere to go. Ask an admin to fix the brand record." },
      { status: 409 }
    );
  }

  // Only this brand's products: an id belonging to another brand reads as not found.
  // (Non-UUID ids would make the uuid comparison throw, so they just go unmatched.)
  const lookupIds = productIds.filter((id) => UUID.test(id));
  const products = lookupIds.length
    ? await db
        .select()
        .from(schema.clientProducts)
        .where(and(eq(schema.clientProducts.clientId, clientId), inArray(schema.clientProducts.id, lookupIds)))
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const startedAt = Date.now();
  const results: Result[] = [];
  let attempted = 0;

  for (const productId of productIds) {
    if (attempted >= MAX_PER_CALL || Date.now() - startedAt > TIME_BUDGET_MS) break;
    attempted++;

    const product = byId.get(productId);
    if (!product) {
      results.push({ id: productId, name: "?", status: "error", error: "Product not found for this brand" });
      continue;
    }

    try {
      if (!product.imageUrl) {
        results.push({ id: productId, name: product.productName, status: "skipped", error: "No source image" });
        continue;
      }

      if (product.videoImageUrl) {
        results.push({ id: productId, name: product.productName, status: "skipped", error: "Already has video image" });
        continue;
      }

      // Download source image
      const r2SourceKey = r2KeyFromUrl(product.imageUrl);
      let imageBuffer: Buffer;

      if (r2SourceKey) {
        const downloaded = await downloadFromR2(r2SourceKey);
        imageBuffer = downloaded.buffer;
      } else {
        const res = await fetch(product.imageUrl, { signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS) });
        if (!res.ok) {
          results.push({ id: productId, name: product.productName, status: "error", error: `Failed to download source image (${res.status})` });
          continue;
        }
        imageBuffer = Buffer.from(await res.arrayBuffer());
      }

      // Resize to 9:16 with white background padding
      const resized = await sharp(imageBuffer)
        .resize(TARGET_WIDTH, TARGET_HEIGHT, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .png()
        .toBuffer();

      // Upload to R2 under client's storage prefix.
      // storagePrefix is the canonical full key prefix (e.g. "brands/<parent>/<sub>"); do NOT pass to r2Key() which would re-prepend "brands/".
      const filename = `${randomUUID()}.png`;
      const key = `${storagePrefix}/video-generation/products/${filename}`;
      const videoImageUrl = await uploadToR2(key, resized, "image/png");

      // Update product
      await db
        .update(schema.clientProducts)
        .set({ videoImageUrl, updatedAt: new Date() })
        .where(and(eq(schema.clientProducts.id, productId), eq(schema.clientProducts.clientId, clientId)));

      results.push({ id: productId, name: product.productName, status: "converted", videoImageUrl });
    } catch (err) {
      results.push({
        id: productId,
        name: product.productName,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    total: results.length,
    converted: results.filter((r) => r.status === "converted").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
    remaining: productIds.slice(attempted),
  });
}
