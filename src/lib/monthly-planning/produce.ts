/**
 * brief→static production for the Monthly Planning Workflow.
 *
 * Reuses the tested custom static pipeline (Agent 1 + Agent 2 with the client's
 * FIXED prompts, loaded from client_static_ad_config — NEVER edited). The brief
 * is fed ONLY through the pipeline's existing `adCopy` DATA input (the same
 * channel a user types into), so no prompt is modified.
 *
 * Submits a single Kie (nano-banana-2) job per item — the global
 * `sweepGeneratingRows` cron poll persists it to R2 and flips it to completed.
 * (The multi-step GPT2 refine chain is a v1.1 enhancement.)
 */

import { db, schema } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { analyzeReferenceAd, generateCustomPrompt } from "@/lib/static-ads/custom-pipeline";
import { submitKieJob } from "@/lib/static-ads/kie-ai";

type PlanItem = typeof schema.planItems.$inferSelect;

/** feed → 4:5 portrait; story/reel → 9:16. */
function ratioForFormat(format: string): string {
  return format === "story" || format === "reel" ? "9:16" : "4:5";
}

/** Pick a reference image: a random active winner, else a random reference-library ad. */
async function pickReference(clientId: string): Promise<string | null> {
  const [winner] = await db
    .select({ imageUrl: schema.winnersLibrary.imageUrl })
    .from(schema.winnersLibrary)
    .where(and(eq(schema.winnersLibrary.clientId, clientId), eq(schema.winnersLibrary.isActive, true)))
    .orderBy(sql`random()`)
    .limit(1);
  if (winner?.imageUrl) return winner.imageUrl;

  const [ref] = await db
    .select({ imageUrl: schema.referenceAdLibrary.imageUrl })
    .from(schema.referenceAdLibrary)
    .where(eq(schema.referenceAdLibrary.isActive, true))
    .orderBy(sql`random()`)
    .limit(1);
  return ref?.imageUrl ?? null;
}

/**
 * Produce a static ad for one plan item. Inserts a static_ad_generations row
 * (status generating, kieJobId set), links it, flips the item to producing.
 * On failure, marks the item error.
 */
export async function produceStaticItem(item: PlanItem, userId: string | null): Promise<void> {
  try {
    if (!item.productId) throw new Error("No product on this static slot");

    const [brief] = await db.select().from(schema.planBriefs).where(eq(schema.planBriefs.planItemId, item.id)).limit(1);
    const payload = (brief?.payload || {}) as Record<string, string>;

    const [product] = await db
      .select()
      .from(schema.clientProducts)
      .where(eq(schema.clientProducts.id, item.productId))
      .limit(1);
    if (!product?.imageUrl) throw new Error("Product has no image");

    const referenceImageUrl = await pickReference(item.clientId);
    if (!referenceImageUrl) throw new Error("No reference ad available (add a winner or reference)");

    // Compose the brief into the pipeline's DATA input (adCopy) — FIXED prompts untouched.
    const adCopy = [
      payload.on_image_copy && `On-image copy: ${payload.on_image_copy}`,
      payload.ad_copy && `Message: ${payload.ad_copy}`,
      payload.visual_direction && `Visual direction: ${payload.visual_direction}`,
      payload.concept && `Concept: ${payload.concept}`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 5000);

    const aspectRatio = ratioForFormat(item.format);

    // Agent 1 (reference analysis) → Agent 2 (image prompt). Both use the
    // client's FIXED prompts from client_static_ad_config, unchanged.
    const analysisJson = await analyzeReferenceAd(referenceImageUrl, item.clientId);
    const { prompt } = await generateCustomPrompt({
      analysisJson,
      adCopy,
      product: {
        name: product.productName,
        imageUrl: product.imageUrl,
        visualDescription: product.keyBenefits,
        targetAudience: product.targetUseCase,
      },
      referenceImageUrl,
      aspectRatio,
      clientId: item.clientId,
    });

    // Brand logos for the Kie image array (same as the custom route).
    const [cfg] = await db
      .select({ logo: schema.clientStaticAdConfig.brandLogoUrl, logoWhite: schema.clientStaticAdConfig.brandLogoWhiteUrl })
      .from(schema.clientStaticAdConfig)
      .where(eq(schema.clientStaticAdConfig.clientId, item.clientId))
      .limit(1);
    const imageUrls = [referenceImageUrl, product.imageUrl, cfg?.logo, cfg?.logoWhite].filter(Boolean) as string[];

    const { taskId } = await submitKieJob({ prompt, imageUrls, aspectRatio, resolution: "2K", outputFormat: "png" });

    const [gen] = await db
      .insert(schema.staticAdGenerations)
      .values({
        userId,
        clientId: item.clientId,
        productId: product.id,
        productName: product.productName,
        styleName: "Monthly Plan",
        finalPrompt: prompt,
        aspectRatio,
        resolution: "2K",
        outputFormat: "PNG",
        status: "generating",
        mode: "monthly",
        referenceImageUrl,
        adCopy,
        analysisJson,
        kieJobId: taskId,
      })
      .returning();

    await db
      .update(schema.planItems)
      .set({ generationId: gen.id, status: "producing", errorMessage: null, updatedAt: new Date() })
      .where(eq(schema.planItems.id, item.id));
  } catch (err) {
    await db
      .update(schema.planItems)
      .set({ status: "error", errorMessage: `Production failed: ${err instanceof Error ? err.message : "unknown"}`, updatedAt: new Date() })
      .where(eq(schema.planItems.id, item.id));
  }
}
