/**
 * Review graphic generation orchestration.
 *
 * For a qualifying review: generate captions (Claude), then submit one
 * Kie / Nano Banana 2 job per platform format. Rows are created in the
 * `generating` state and finished asynchronously by the poll-and-persist
 * sweep (see ./poll-and-persist.ts). Reuses the proven static-ad Kie client.
 */

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { submitKieJob } from "@/lib/static-ads/kie-ai";
import { generateReviewCaptions, type ReviewCaptions } from "@/lib/reviews/captions";

export const REVIEW_FORMATS = [
  { key: "ig_feed", label: "Instagram Feed", aspectRatio: "4:5" },
  { key: "story", label: "Instagram Story", aspectRatio: "9:16" },
  { key: "fb", label: "Facebook", aspectRatio: "1:1" },
] as const;

type ReviewRow = typeof schema.reviews.$inferSelect;

function firstName(name: string | null): string {
  if (!name) return "a happy customer";
  return name.trim().split(/\s+/)[0];
}

function buildKiePrompt(opts: {
  brandName: string;
  captions: ReviewCaptions;
  stars: number | null;
  reviewerName: string | null;
  formatLabel: string;
}): string {
  const stars = opts.stars ?? 5;
  return [
    `Design a polished, on-brand social media testimonial graphic for "${opts.brandName}", a promotional products company.`,
    `Format: ${opts.formatLabel}.`,
    `Feature this short customer quote as the clean, highly legible focal text: "${opts.captions.pullQuote}".`,
    `Show ${stars} gold star rating and attribute the quote to "${firstName(opts.reviewerName)}".`,
    `Use the attached image(s) as the real product / customer photo and incorporate the brand logo if attached.`,
    `Style: modern, professional, trustworthy, high-contrast and uncluttered, with the quote text rendered crisply and correctly spelled.`,
    `Do not add any extra paragraphs of text beyond the quote, the name, and the star rating. No watermarks.`,
  ].join(" ");
}

/**
 * Generate a full review graphic set for one review.
 * Inserts the parent `review_graphics` row + one `review_graphic_assets` row
 * per format (each with its own Kie job), and marks the review as rendered.
 * Returns the parent graphic id. Throws if caption generation fails.
 */
export async function generateReviewGraphicForReview(opts: {
  review: ReviewRow;
  brandName: string;
  userId: string | null;
  brandContext?: string | null;
}): Promise<string> {
  const { review, brandName, userId } = opts;

  // 1) Captions (Claude). If this throws, the caller records the failure.
  const captions = await generateReviewCaptions({
    brandName,
    reviewerName: review.reviewerName,
    stars: review.stars,
    text: review.text || review.textTranslated || "",
    brandContext: opts.brandContext,
  });

  // 2) Parent row (holds captions + approval state).
  // The reviews table keys on `brandId`; review_graphics uses `clientId` (= brand id).
  const [graphic] = await db
    .insert(schema.reviewGraphics)
    .values({
      reviewId: review.reviewId,
      clientId: review.brandId,
      userId,
      reviewerName: review.reviewerName,
      reviewText: review.text || review.textTranslated || null,
      stars: review.stars,
      pullQuote: captions.pullQuote,
      instagramCaption: captions.instagramCaption,
      storiesCaption: captions.storiesCaption,
      facebookCaption: captions.facebookCaption,
      cta: captions.cta,
      hashtags: captions.hashtags,
      status: "generating",
    })
    .returning();

  // 3) Reference images for Kie: customer photo(s) (prefer archived R2 copies) + brand logo
  const archived = Array.isArray(review.archivedImageUrls) ? (review.archivedImageUrls as string[]) : [];
  const original = Array.isArray(review.reviewImageUrls) ? (review.reviewImageUrls as string[]) : [];
  const photoUrls = (archived.length ? archived : original).filter(Boolean).slice(0, 3);

  let brandLogoUrl: string | null = null;
  if (review.brandId) {
    const [cfg] = await db
      .select({ brandLogoUrl: schema.clientStaticAdConfig.brandLogoUrl })
      .from(schema.clientStaticAdConfig)
      .where(eq(schema.clientStaticAdConfig.clientId, review.brandId))
      .limit(1);
    brandLogoUrl = cfg?.brandLogoUrl ?? null;
  }
  const imageUrls = [...photoUrls, ...(brandLogoUrl ? [brandLogoUrl] : [])];

  // 4) One Kie job per format
  for (const format of REVIEW_FORMATS) {
    const prompt = buildKiePrompt({
      brandName,
      captions,
      stars: review.stars,
      reviewerName: review.reviewerName,
      formatLabel: format.label,
    });

    const [asset] = await db
      .insert(schema.reviewGraphicAssets)
      .values({
        graphicId: graphic.id,
        format: format.key,
        aspectRatio: format.aspectRatio,
        status: "generating",
      })
      .returning();

    try {
      const { taskId } = await submitKieJob({
        prompt,
        imageUrls,
        aspectRatio: format.aspectRatio,
        resolution: "2K",
        outputFormat: "png",
      });
      await db
        .update(schema.reviewGraphicAssets)
        .set({ kieJobId: taskId, updatedAt: new Date() })
        .where(eq(schema.reviewGraphicAssets.id, asset.id));
    } catch (err) {
      await db
        .update(schema.reviewGraphicAssets)
        .set({
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Kie submission failed",
          updatedAt: new Date(),
        })
        .where(eq(schema.reviewGraphicAssets.id, asset.id));
    }
  }

  // 5) Mark review rendered so it isn't picked again
  await db
    .update(schema.reviews)
    .set({ rendered: true, renderedAt: new Date() })
    .where(eq(schema.reviews.reviewId, review.reviewId));

  return graphic.id;
}
