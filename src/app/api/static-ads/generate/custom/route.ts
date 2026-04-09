import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { analyzeReferenceAd, generateCustomPrompt, BRAND_LOGO_URL } from "@/lib/static-ads/custom-pipeline";
import { submitKieJob } from "@/lib/static-ads/kie-ai";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — two Claude calls + image processing + Kie submit

/**
 * POST /api/static-ads/generate/custom
 *
 * Runs the full 3-step pipeline synchronously:
 * 1. Claude Vision analyzes reference ad
 * 2. Claude generates image prompt
 * 3. Kie AI job submitted
 *
 * Returns: { generationId, kieJobId, completedSteps }
 * Body: { productId, referenceImageUrl, adCopy?, aspectRatio? }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  let body: { productId: string; referenceImageUrl: string; adCopy?: string; aspectRatio?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { productId, referenceImageUrl, adCopy, aspectRatio } = body;

  if (!productId || !referenceImageUrl) {
    return NextResponse.json({ error: "productId and referenceImageUrl are required" }, { status: 400 });
  }

  // Input validation
  const VALID_RATIOS = ["auto", "1:1", "2:3", "3:2", "4:5", "5:4", "9:16", "16:9"];
  if (aspectRatio && !VALID_RATIOS.includes(aspectRatio)) {
    return NextResponse.json({ error: `Invalid aspect ratio: ${aspectRatio}` }, { status: 400 });
  }
  if (adCopy && adCopy.length > 5000) {
    return NextResponse.json({ error: "Ad copy must be under 5000 characters" }, { status: 400 });
  }

  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!product.imageUrl) {
    return NextResponse.json({ error: "Product has no image — required for ad generation" }, { status: 400 });
  }

  // ── Step 1: Analyze reference ad ──
  let analysisJson: string;
  try {
    analysisJson = await analyzeReferenceAd(referenceImageUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed", failedStep: 1 },
      { status: 500 }
    );
  }

  // ── Step 2: Generate prompt ──
  let generatedPrompt: string;
  try {
    const result = await generateCustomPrompt({
      analysisJson,
      adCopy: adCopy?.trim() || undefined,
      product: {
        name: product.name,
        imageUrl: product.imageUrl!,
        visualDescription: product.visualDescription,
        solution: product.solution,
        targetAudience: product.targetAudience,
      },
      referenceImageUrl,
      aspectRatio: aspectRatio || "auto",
    });
    generatedPrompt = result.prompt;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Prompt generation failed", failedStep: 2 },
      { status: 500 }
    );
  }

  // ── Step 3: Submit to Kie AI ──
  const resolvedAspectRatio = aspectRatio || "auto";
  const [generation] = await db
    .insert(schema.staticAdGenerations)
    .values({
      userId: portalUser.id,
      productId: product.id,
      productName: product.name,
      styleName: "Custom",
      finalPrompt: generatedPrompt,
      aspectRatio: resolvedAspectRatio,
      resolution: "1K",
      outputFormat: "PNG",
      status: "pending",
      mode: "custom",
      referenceImageUrl,
      adCopy: adCopy?.trim() || null,
      analysisJson,
    })
    .returning();

  try {
    // Generate presigned URLs so Kie AI can download from private R2 bucket
    const [accessibleRefUrl, accessibleProductUrl, accessibleLogoUrl] = await Promise.all([
      toAccessibleUrl(referenceImageUrl),
      toAccessibleUrl(product.imageUrl!),
      toAccessibleUrl(BRAND_LOGO_URL),
    ]);

    const kieResult = await submitKieJob({
      prompt: generatedPrompt,
      imageUrls: [accessibleRefUrl, accessibleProductUrl, accessibleLogoUrl],
      aspectRatio: resolvedAspectRatio,
    });

    await db
      .update(schema.staticAdGenerations)
      .set({
        kieJobId: kieResult.taskId,
        status: "generating",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, generation.id));

    return NextResponse.json({
      generationId: generation.id,
      kieJobId: kieResult.taskId,
      completedSteps: 3,
    });
  } catch (err) {
    await db
      .update(schema.staticAdGenerations)
      .set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Kie AI submission failed",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, generation.id));

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Image generation submission failed", failedStep: 3, generationId: generation.id },
      { status: 500 }
    );
  }
}
