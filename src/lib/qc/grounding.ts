// Multi-client grounding for the QC gate. Assembles the per-client ruleset
// (compliance_config WHERE client_id) + the brand row (name / colour / category) + the
// brand-intel constraints section + the client's USPs into one object every judge call
// consumes. A client with NO ruleset row still grades (AI-judgement only, source='none').
//
// productGrounding resolves a generation row's productId → the client's REAL product photo
// — the ground truth the product_fidelity criterion is judged against.
//
// NOTE vs the Pure Path donor: this portal's client table is `brands` (aliased as
// schema.clients), the name column is `brandName`, and client_products carries a SINGLE
// image_url (no back photo), so product grounding is one-sided here.

import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type BrandGrounding = {
  clientId: string | null;
  brandName: string;
  brandColor: string | null;
  category: string | null;
  primaryMarket: string | null;
  visualRules: string[];
  paletteHexes: string[];
  productFacts: string[];
  brandSafetyNotes: string | null;
  bannedPhrasings: string[];
  /** Written profile of what this client's past winners have in common. Advisory. */
  winnerProfile: string | null;
  version: number | null;
  source: "flat" | "none"; // 'flat' = a config row exists; 'none' = AI-judgement only
};

export type ProductGrounding = {
  productName: string | null;
  category: string | null;
  keyBenefits: string | null;
  /** Raw product photo URLs used as ground truth (front photo first). */
  referenceUrls: string[];
};

const clean = (s: string | null | undefined): string => (s ?? "").trim();

/** Neutral fallback for reviews with no client attached. */
function neutralGrounding(): BrandGrounding {
  return {
    clientId: null,
    brandName: "the brand",
    brandColor: null,
    category: null,
    primaryMarket: null,
    visualRules: [],
    paletteHexes: [],
    productFacts: [],
    brandSafetyNotes: null,
    bannedPhrasings: [],
    winnerProfile: null,
    version: null,
    source: "none",
  };
}

/** Prefer sectionType match (durable), fall back to a title keyword match so grounding
 *  still works if an editor save wiped section_type. */
function firstMatch(
  sections: Array<{ title: string; sectionType: string; content: string }>,
  sectionTypes: string[],
  titleKeywords: string[]
): string {
  const byType = sections.find((s) => s.content && sectionTypes.includes((s.sectionType || "").toLowerCase()));
  if (byType) return byType.content;
  const byTitle = sections.find((s) => s.content && titleKeywords.some((k) => s.title.toLowerCase().includes(k)));
  return byTitle?.content || "";
}

export async function buildBrandGrounding(clientId: string | null): Promise<BrandGrounding> {
  if (!clientId) return neutralGrounding();

  const [[client], [cfg], rawSections, usps] = await Promise.all([
    db
      .select({
        brandName: schema.brands.brandName,
        brandColor: schema.brands.brandColor,
        category: schema.brands.category,
        primaryMarket: schema.brands.primaryMarket,
      })
      .from(schema.brands)
      .where(eq(schema.brands.id, clientId))
      .limit(1),
    db.select().from(schema.complianceConfig).where(eq(schema.complianceConfig.clientId, clientId)).limit(1),
    db
      .select({
        title: schema.clientBrandIntelligence.title,
        sectionType: schema.clientBrandIntelligence.sectionType,
        content: schema.clientBrandIntelligence.content,
      })
      .from(schema.clientBrandIntelligence)
      .where(eq(schema.clientBrandIntelligence.clientId, clientId))
      .orderBy(asc(schema.clientBrandIntelligence.sortOrder)),
    db
      .select({ uspText: schema.clientUsps.uspText, isPrimary: schema.clientUsps.isPrimary })
      .from(schema.clientUsps)
      .where(eq(schema.clientUsps.clientId, clientId)),
  ]);

  if (!client) return neutralGrounding();

  const sections = rawSections
    .filter((s) => clean(s.content))
    .map((s) => ({ title: s.title, sectionType: clean(s.sectionType), content: clean(s.content ?? "") }));

  // Brand-safety notes: config notes + the brand-intel constraints section (truncated) +
  // the client's primary USPs (they define what "conveys value" means for this brand).
  const constraints = firstMatch(sections, ["constraints"], ["constraint", "guardrail", "compliance"]);
  const safetyBits: string[] = [];
  if (clean(cfg?.brandSafetyNotes)) safetyBits.push(clean(cfg?.brandSafetyNotes));
  if (constraints) safetyBits.push(constraints.slice(0, 600));
  const primaryUsps = usps
    .filter((u) => clean(u.uspText))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .slice(0, 5)
    .map((u) => `- ${clean(u.uspText)}`);
  if (primaryUsps.length) safetyBits.push(`CORE VALUE PROPOSITIONS (what a strong creative should land):\n${primaryUsps.join("\n")}`);
  const brandSafetyNotes = safetyBits.join("\n") || null;

  return {
    clientId,
    brandName: clean(client.brandName) || "the brand",
    brandColor: clean(client.brandColor) || null,
    category: clean(client.category) || null,
    primaryMarket: clean(client.primaryMarket) || null,
    visualRules: (cfg?.visualRules ?? []).filter(Boolean),
    paletteHexes: (cfg?.paletteHexes ?? []).filter(Boolean),
    productFacts: (cfg?.productFacts ?? []).filter(Boolean),
    brandSafetyNotes,
    bannedPhrasings: (cfg?.bannedPhrasings ?? []).filter(Boolean),
    winnerProfile: clean(cfg?.winnerProfile) || null,
    version: cfg?.version ?? null,
    source: cfg ? "flat" : "none",
  };
}

/**
 * Resolve the ground-truth product photo for a generation row. Rows without a productId
 * return no references — the rubric then degrades to integrity-only product judging
 * (warping/garbling), which is a real loss of signal, so we log it once per grade.
 */
export async function productGrounding(row: { productId: string | null }): Promise<ProductGrounding> {
  const empty: ProductGrounding = { productName: null, category: null, keyBenefits: null, referenceUrls: [] };
  if (!row.productId) return empty;

  const [product] = await db
    .select({
      productName: schema.clientProducts.productName,
      category: schema.clientProducts.category,
      keyBenefits: schema.clientProducts.keyBenefits,
      imageUrl: schema.clientProducts.imageUrl,
      videoImageUrl: schema.clientProducts.videoImageUrl,
    })
    .from(schema.clientProducts)
    .where(eq(schema.clientProducts.id, row.productId))
    .limit(1);

  if (!product) return empty;

  const front = clean(product.imageUrl);
  const alt = clean(product.videoImageUrl);
  // Dedupe: many products reuse the same asset for both columns.
  const referenceUrls = [front, alt !== front ? alt : ""].filter(Boolean);

  if (!referenceUrls.length) {
    console.warn(`[qc/grounding] product ${row.productId} has no image — grading integrity only`);
  }

  return {
    productName: clean(product.productName) || null,
    category: clean(product.category) || null,
    keyBenefits: clean(product.keyBenefits) || null,
    referenceUrls,
  };
}
