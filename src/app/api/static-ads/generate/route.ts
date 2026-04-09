import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { submitKieJob } from "@/lib/static-ads/kie-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const body = await req.json();
    const { adStyleId, productId, aspectRatio } = body;

    if (!adStyleId) {
      return NextResponse.json({ error: "adStyleId is required" }, { status: 400 });
    }
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    // Load ad style
    const [style] = await db
      .select()
      .from(schema.adStyles)
      .where(eq(schema.adStyles.id, adStyleId))
      .limit(1);

    if (!style) {
      return NextResponse.json({ error: "Ad style not found" }, { status: 404 });
    }

    // Load product
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (!product.imageUrl) {
      return NextResponse.json({ error: "Product has no image. Please add a product image first." }, { status: 400 });
    }

    // Load product-specific prompt
    const [stylePrompt] = await db
      .select()
      .from(schema.adStylePrompts)
      .where(
        and(
          eq(schema.adStylePrompts.adStyleId, adStyleId),
          eq(schema.adStylePrompts.productId, productId)
        )
      )
      .limit(1);

    if (!stylePrompt) {
      return NextResponse.json(
        { error: "No prompt available for this product/style combination. Prompts need to be adapted for this product first." },
        { status: 400 }
      );
    }

    const finalPrompt = stylePrompt.prompt;

    const resolvedAspectRatio = aspectRatio || style.aspectRatio || "1:1";

    // Insert generation record
    const [generation] = await db
      .insert(schema.staticAdGenerations)
      .values({
        userId: authResult.portalUser.id,
        adStyleId: style.id,
        productId: product.id,
        styleName: style.name,
        productName: product.name,
        finalPrompt,
        aspectRatio: resolvedAspectRatio,
        status: "pending",
      })
      .returning();

    // Build image URLs for Kie AI
    const imageUrls: string[] = [];
    if (style.referenceImageUrl) imageUrls.push(style.referenceImageUrl);
    if (product.imageUrl) imageUrls.push(product.imageUrl);

    // Submit to Kie AI
    try {
      const { taskId } = await submitKieJob({
        prompt: finalPrompt,
        imageUrls,
        aspectRatio: resolvedAspectRatio,
        resolution: "1K",
        outputFormat: "png",
      });

      await db
        .update(schema.staticAdGenerations)
        .set({
          kieJobId: taskId,
          status: "generating",
          updatedAt: new Date(),
        })
        .where(eq(schema.staticAdGenerations.id, generation.id));

      return NextResponse.json({
        id: generation.id,
        status: "generating",
        kieJobId: taskId,
      });
    } catch (kieErr) {
      // Kie AI submission failed — mark as error
      const errMsg = kieErr instanceof Error ? kieErr.message : "Kie AI submission failed";
      await db
        .update(schema.staticAdGenerations)
        .set({
          status: "error",
          errorMessage: errMsg,
          updatedAt: new Date(),
        })
        .where(eq(schema.staticAdGenerations.id, generation.id));

      return NextResponse.json({
        id: generation.id,
        status: "error",
        error: errMsg,
      }, { status: 502 });
    }
  } catch (err) {
    console.error("[static-ads/generate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
