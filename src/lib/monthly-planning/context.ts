/**
 * Per-brand grounding for the Monthly Planning Workflow.
 *
 * Gathers exactly what the planner + brief generators need for one brand:
 * products (with images → static-eligible), USPs, brand-intelligence sections,
 * whether a reference winner exists (static needs one), and the brand's posting
 * cadence (slots/month) so the plan distributes realistically.
 */

import { db, schema } from "@/lib/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { resolvePrefs, type PostingPrefs } from "@/lib/posting/slots";

export type BrandProduct = {
  id: string;
  name: string;
  category: string | null;
  keyBenefits: string | null;
  targetUseCase: string | null;
  isHero: boolean;
  imageUrl: string | null;
};

export type BrandContext = {
  clientId: string;
  slug: string | null;
  brandName: string;
  brandIntel: string; // rendered "## title\ncontent" sections
  usps: string[];
  products: BrandProduct[];
  /** Products usable for brief→static generation (have an image). */
  staticEligibleProducts: BrandProduct[];
  hasReference: boolean; // a winner exists → brief→static can run
  hasStaticConfig: boolean; // client_static_ad_config row exists
  prefs: PostingPrefs;
};

export async function loadBrandContext(clientId: string): Promise<BrandContext> {
  const [brand] = await db
    .select({ name: schema.brands.brandName, slug: schema.brands.clientSlug, settings: schema.brands.settings })
    .from(schema.brands)
    .where(eq(schema.brands.id, clientId))
    .limit(1);

  const [intelRows, uspRows, productRows, winnerCount, cfg] = await Promise.all([
    db
      .select({ title: schema.clientBrandIntelligence.title, content: schema.clientBrandIntelligence.content })
      .from(schema.clientBrandIntelligence)
      .where(eq(schema.clientBrandIntelligence.clientId, clientId))
      .orderBy(schema.clientBrandIntelligence.sortOrder),
    db
      .select({ text: schema.clientUsps.uspText, isPrimary: schema.clientUsps.isPrimary })
      .from(schema.clientUsps)
      .where(eq(schema.clientUsps.clientId, clientId)),
    db
      .select()
      .from(schema.clientProducts)
      .where(and(eq(schema.clientProducts.clientId, clientId), eq(schema.clientProducts.status, "Active")))
      .orderBy(desc(schema.clientProducts.isHeroProduct)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.winnersLibrary)
      .where(and(eq(schema.winnersLibrary.clientId, clientId), eq(schema.winnersLibrary.isActive, true))),
    db
      .select({ id: schema.clientStaticAdConfig.id })
      .from(schema.clientStaticAdConfig)
      .where(eq(schema.clientStaticAdConfig.clientId, clientId))
      .limit(1),
  ]);

  const products: BrandProduct[] = productRows.map((p) => ({
    id: p.id,
    name: p.productName,
    category: p.category,
    keyBenefits: p.keyBenefits,
    targetUseCase: p.targetUseCase,
    isHero: p.isHeroProduct,
    imageUrl: p.imageUrl,
  }));

  const brandIntel = intelRows
    .map((s) => `## ${s.title}\n${s.content || ""}`)
    .join("\n\n")
    .slice(0, 6000);

  const usps = uspRows
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((u) => u.text)
    .filter(Boolean);

  return {
    clientId,
    slug: brand?.slug ?? null,
    brandName: brand?.name || "Brand",
    brandIntel: brandIntel || "(no brand intelligence on file)",
    usps,
    products,
    staticEligibleProducts: products.filter((p) => !!p.imageUrl),
    hasReference: (winnerCount[0]?.count ?? 0) > 0,
    hasStaticConfig: !!cfg[0],
    prefs: resolvePrefs((brand?.settings as Record<string, unknown>)?.posting),
  };
}

/** A brand can produce static ads only if it has a config, a reference, and a product image. */
export function canProduceStatic(ctx: BrandContext): boolean {
  return ctx.hasStaticConfig && ctx.hasReference && ctx.staticEligibleProducts.length > 0;
}
