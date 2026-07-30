/**
 * Which systems a brand is actually set up to run — derived from its data.
 *
 * This replaces four hardcoded slug arrays in the sidebar. Those arrays meant
 * onboarding a brand required a code edit and a redeploy: The Cap Company, which
 * the client added themselves, was invisible to every system for exactly that
 * reason.
 *
 * Two kinds of surface, and only one of them gets gated:
 *
 *   - SETUP surfaces (Competitor Research, Post Scheduler) are where the
 *     prerequisites are entered, so gating them on those prerequisites would
 *     lock a brand out of its own onboarding. They stay on.
 *   - PRODUCTION surfaces hard-fail or produce garbage without their inputs, and
 *     those inputs are entered elsewhere. Those are gated.
 *
 * This is nav-only. Every server route is already clientId-scoped and authorises
 * independently, so this changes discoverability, not access control.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type ClientCapabilities = {
  staticAds: boolean;
  video: boolean;
  research: boolean;
  briefs: boolean;
  reviews: boolean;
  posting: boolean;
  monthlyPlanning: boolean;
  qualityControl: boolean;
  /** Human-readable reason per gated-off system, for the UI and the verify script. */
  reasons: Record<string, string>;
};

export const DEFAULT_CAPABILITIES: ClientCapabilities = {
  staticAds: false,
  video: false,
  research: true,
  briefs: false,
  reviews: false,
  posting: true,
  monthlyPlanning: false,
  qualityControl: false,
  reasons: {},
};

export async function capabilitiesForClient(clientId: string): Promise<ClientCapabilities> {
  const [brand] = await db
    .select({
      reviewsEnabled: schema.brands.reviewsEnabled,
      googleMapsUrl: schema.brands.googleMapsUrl,
    })
    .from(schema.brands)
    .where(eq(schema.brands.id, clientId))
    .limit(1);

  const n = sql<number>`count(*)::int`;
  const [[cfg], [withImage], [products], [chars], [competitors]] = await Promise.all([
    db.select({ n }).from(schema.clientStaticAdConfig).where(eq(schema.clientStaticAdConfig.clientId, clientId)),
    db
      .select({ n })
      .from(schema.clientProducts)
      .where(and(eq(schema.clientProducts.clientId, clientId), isNotNull(schema.clientProducts.imageUrl))),
    db.select({ n }).from(schema.clientProducts).where(eq(schema.clientProducts.clientId, clientId)),
    db.select({ n }).from(schema.characters).where(eq(schema.characters.clientId, clientId)),
    db.select({ n }).from(schema.clientCompetitors).where(eq(schema.clientCompetitors.clientId, clientId)),
  ]);
  const staticConfig = cfg?.n ?? 0;
  const productsWithImage = withImage?.n ?? 0;
  const anyProduct = products?.n ?? 0;
  const characterCount = chars?.n ?? 0;
  const competitorCount = competitors?.n ?? 0;

  const reasons: Record<string, string> = {};

  // Static ads: Agent 1/2 prompts drive the whole pipeline, and every ad renders
  // a product image. Without either the system errors on first use.
  const staticAds = staticConfig > 0 && productsWithImage > 0;
  if (!staticAds) {
    reasons.staticAds =
      staticConfig === 0
        ? "No static-ad prompt config — generate the brand's Ad Prompts first."
        : "No product has an image — add one on the brand's Products tab.";
  }

  // Video: A-Roll needs no product, but it does need a subject. A brand with
  // neither products nor characters has nothing to make a video of.
  const video = anyProduct > 0 || characterCount > 0;
  if (!video) reasons.video = "No products and no characters yet.";

  // Creative Briefs are written from scraped competitor ads.
  const briefs = competitorCount > 0;
  if (!briefs) reasons.briefs = "No competitors tracked — add them in Competitor Research.";

  // Review Graphics pulls from a Google Maps listing; both must be set by an admin.
  const reviews = !!brand?.reviewsEnabled && !!brand?.googleMapsUrl;
  if (!reviews) {
    reasons.reviews = !brand?.reviewsEnabled
      ? "Reviews are not enabled for this brand."
      : "No Google Maps URL on the brand record.";
  }

  // Monthly Planning schedules output from the generative systems, and Quality
  // Control grades it — neither is meaningful with both of those off.
  const monthlyPlanning = staticAds || video;
  if (!monthlyPlanning) reasons.monthlyPlanning = "No generative system is set up for this brand yet.";
  const qualityControl = monthlyPlanning;
  if (!qualityControl) reasons.qualityControl = reasons.monthlyPlanning;

  return {
    staticAds,
    video,
    // Setup surfaces — always on (see the note at the top of this file).
    research: true,
    briefs,
    reviews,
    posting: true,
    monthlyPlanning,
    qualityControl,
    reasons,
  };
}
