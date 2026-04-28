import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { resolveClientId } from "@/lib/client-api-helpers";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { downloadFromR2, uploadToR2, r2KeyFromUrl } from "@/lib/r2";
import sharp from "sharp";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Target: 9:16 portrait (1080x1920)
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;

/**
 * POST /api/clients/[slug]/products/convert-video-image
 *
 * Takes products' existing imageUrl, resizes/pads to 9:16,
 * uploads to R2, and saves as videoImageUrl.
 *
 * Body: { productIds: string[] }
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

  const body = await request.json();
  const productIds: string[] = body.productIds || (body.productId ? [body.productId] : []);

  if (productIds.length === 0) {
    return NextResponse.json({ error: "No product IDs provided" }, { status: 400 });
  }

  // Resolve R2 storage prefix for this client
  const storagePrefix = (await getClientStoragePrefix(clientId)) || "web-profits";

  const results: { id: string; name: string; status: string; videoImageUrl?: string; error?: string }[] = [];

  for (const productId of productIds) {
    try {
      const [product] = await db
        .select()
        .from(schema.clientProducts)
        .where(eq(schema.clientProducts.id, productId));

      if (!product) {
        results.push({ id: productId, name: "?", status: "error", error: "Product not found" });
        continue;
      }

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
        const res = await fetch(product.imageUrl);
        if (!res.ok) {
          results.push({ id: productId, name: product.productName, status: "error", error: "Failed to download source image" });
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
        .where(eq(schema.clientProducts.id, productId));

      results.push({ id: productId, name: product.productName, status: "converted", videoImageUrl });
    } catch (err) {
      results.push({
        id: productId,
        name: "?",
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
  });
}
