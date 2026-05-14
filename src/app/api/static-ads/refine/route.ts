import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { submitGptImage2Job, REFINE_PROMPT, mapAspectForGpt2 } from "@/lib/static-ads/kie-ai";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/static-ads/refine
 *
 * Body: { variationIds: string[], clientId: string }
 *
 * Takes 1-10 completed variation IDs, generates a "product-consistent" final
 * ad for each by calling Kie's GPT Image 2 image-to-image with the variation
 * image + the original product image and a fixed prompt. Each refinement is
 * its own singleton row (mode='refined', source_generation_id = variation.id).
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  let body: { variationIds?: string[]; clientId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const variationIds = Array.isArray(body.variationIds) ? body.variationIds : [];
  const { clientId } = body;

  if (variationIds.length === 0) {
    return NextResponse.json({ error: "Pick at least one variation to refine" }, { status: 400 });
  }
  if (variationIds.length > 10) {
    return NextResponse.json({ error: "Up to 10 refinements per request" }, { status: 400 });
  }
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  // Load all source variations in one query and IDOR-check.
  const sources = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(inArray(schema.staticAdGenerations.id, variationIds));

  if (sources.length !== variationIds.length) {
    return NextResponse.json({ error: "One or more variations not found" }, { status: 404 });
  }

  for (const source of sources) {
    if (source.clientId !== clientId) {
      return NextResponse.json(
        { error: "Variation belongs to a different client" },
        { status: 403 }
      );
    }
    if (source.status !== "completed" || !source.imageUrl) {
      return NextResponse.json(
        { error: `Variation ${source.id} is not completed yet` },
        { status: 400 }
      );
    }
    if (!source.productId) {
      return NextResponse.json(
        { error: `Variation ${source.id} has no product attached` },
        { status: 400 }
      );
    }
  }

  // Resolve all product image URLs in one trip.
  const productIds = Array.from(new Set(sources.map((s) => s.productId!).filter(Boolean)));
  const products = await db
    .select()
    .from(schema.clientProducts)
    .where(inArray(schema.clientProducts.id, productIds));
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const source of sources) {
    const product = productById.get(source.productId!);
    if (!product || !product.imageUrl) {
      return NextResponse.json(
        { error: `Product image missing for variation ${source.id}` },
        { status: 400 }
      );
    }
  }

  // Insert one "refined" row per source variation. mode='refined',
  // sourceGenerationId points back at the variation, batchId stays NULL
  // (each refined ad is its own singleton, per design).
  const generations = await db
    .insert(schema.staticAdGenerations)
    .values(
      sources.map((source) => ({
        userId: portalUser.id,
        clientId,
        productId: source.productId,
        productName: source.productName,
        styleName: "Refined",
        finalPrompt: REFINE_PROMPT,
        aspectRatio: source.aspectRatio,
        resolution: source.resolution || "2K",
        outputFormat: "PNG",
        status: "pending",
        mode: "refined",
        referenceImageUrl: source.imageUrl, // The variation IS the reference for the refinement.
        adCopy: source.adCopy,
        analysisJson: null,
        sourceGenerationId: source.id,
        // batchId/batchSize/batchIndex default to NULL/1/1 — refined ads are singletons.
      }))
    )
    .returning();

  // Fire one GPT Image 2 submission per source variation, in parallel.
  const kieResults = await Promise.allSettled(
    sources.map(async (source) => {
      const product = productById.get(source.productId!)!;
      const [variationUrl, productUrl] = await Promise.all([
        toAccessibleUrl(source.imageUrl!),
        toAccessibleUrl(product.imageUrl!),
      ]);
      return submitGptImage2Job({
        prompt: REFINE_PROMPT,
        inputUrls: [variationUrl, productUrl],
        aspectRatio: mapAspectForGpt2(source.aspectRatio),
        resolution: source.resolution || "2K",
      });
    })
  );

  // Per-row update: taskId on success, error message on failure.
  await Promise.all(
    kieResults.map((result, i) => {
      const gen = generations[i];
      if (result.status === "fulfilled") {
        return db
          .update(schema.staticAdGenerations)
          .set({
            kieJobId: result.value.taskId,
            status: "generating",
            updatedAt: new Date(),
          })
          .where(eq(schema.staticAdGenerations.id, gen.id));
      }
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : "GPT Image 2 submission failed";
      return db
        .update(schema.staticAdGenerations)
        .set({
          status: "error",
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(schema.staticAdGenerations.id, gen.id));
    })
  );

  const succeeded = kieResults.filter((r) => r.status === "fulfilled").length;
  if (succeeded === 0) {
    const firstReason = kieResults.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    return NextResponse.json(
      {
        error:
          firstReason?.reason instanceof Error
            ? firstReason.reason.message
            : "All refinement submissions failed",
        generationIds: generations.map((g) => g.id),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    generationIds: generations.map((g) => g.id),
  });
}
