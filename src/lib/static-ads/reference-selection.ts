/**
 * Per-brand reference selection.
 *
 * The reference ad is not a light touch — it is fed to Agent 1 (vision), to
 * Agent 2 (vision), AND to Kie as image slot 0, and it transfers layout,
 * composition, typographic hierarchy and copy *structure*. Whatever reference a
 * brand draws is therefore the single biggest determinant of whether its ads
 * look like its own.
 *
 * Before this module every brand drew at random from one global pool seeded from
 * a cross-portal corpus, so all 8 promo brands were being handed the same
 * (frequently beauty-industry) skeletons.
 *
 * Resolution order — first non-empty tier wins:
 *   1. the brand's own winners        (proven creative for THIS brand)
 *   2. the brand's own references     (curated in QC → Reference Library)
 *   3. the shared pool, filtered by the client's allowedIndustries
 *   4. the shared pool, unfiltered    (last resort, so generation never blocks)
 *
 * Tier 3+ is the "not yet distinct" state — callers surface it in the UI rather
 * than letting it stay silent, which is how the old behaviour went unnoticed.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type ReferenceTier = "winner" | "brand" | "industry" | "shared";

export type PickedReference = {
  imageUrl: string;
  name: string;
  tier: ReferenceTier;
  /** True when the reference is not specific to this brand (tier 3 or 4). */
  isShared: boolean;
};

/** Collapse an industry label to a comparison key: lowercase, alphanumerics only. */
export function normalizeIndustry(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Parse client_static_ad_config.allowed_industries (stored as a JSON string). */
export function parseAllowedIndustries(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).map((s) => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** The industries this brand's shared-pool fallback is limited to (may be empty). */
export async function allowedIndustriesFor(clientId: string | null): Promise<string[]> {
  if (!clientId) return [];
  const [cfg] = await db
    .select({ allowedIndustries: schema.clientStaticAdConfig.allowedIndustries })
    .from(schema.clientStaticAdConfig)
    .where(eq(schema.clientStaticAdConfig.clientId, clientId))
    .limit(1);
  return parseAllowedIndustries(cfg?.allowedIndustries);
}

/**
 * Pick one reference for a brand. Returns null only when the library is empty
 * outright.
 *
 * @param opts.includeWinners set false for the interactive picker, where the
 *        user chooses winners explicitly via a separate mode.
 */
export async function pickReferenceForClient(
  clientId: string | null,
  opts: { includeWinners?: boolean } = {}
): Promise<PickedReference | null> {
  const { includeWinners = true } = opts;

  // 1. The brand's own winners.
  if (includeWinners && clientId) {
    const [winner] = await db
      .select({ imageUrl: schema.winnersLibrary.imageUrl, name: schema.winnersLibrary.name })
      .from(schema.winnersLibrary)
      .where(and(eq(schema.winnersLibrary.clientId, clientId), eq(schema.winnersLibrary.isActive, true)))
      .orderBy(sql`random()`)
      .limit(1);
    if (winner?.imageUrl) {
      return { imageUrl: winner.imageUrl, name: winner.name, tier: "winner", isShared: false };
    }
  }

  // 2. The brand's own references.
  if (clientId) {
    const [own] = await db
      .select({ imageUrl: schema.referenceAdLibrary.imageUrl, name: schema.referenceAdLibrary.name })
      .from(schema.referenceAdLibrary)
      .where(and(eq(schema.referenceAdLibrary.clientId, clientId), eq(schema.referenceAdLibrary.isActive, true)))
      .orderBy(sql`random()`)
      .limit(1);
    if (own?.imageUrl) {
      return { imageUrl: own.imageUrl, name: own.name, tier: "brand", isShared: false };
    }
  }

  // 3. Shared pool, narrowed to the brand's allowed industries.
  //
  // Matched case- and punctuation-insensitively: the corpus mixes spellings of
  // the same vertical ("Health + Wellness" vs "Health and Wellness"), and a
  // hand-typed allow-list will not reproduce a given row's exact casing.
  const industries = await allowedIndustriesFor(clientId);
  if (industries.length) {
    const normalized = industries.map(normalizeIndustry).filter(Boolean);
    const [byIndustry] = await db
      .select({ imageUrl: schema.referenceAdLibrary.imageUrl, name: schema.referenceAdLibrary.name })
      .from(schema.referenceAdLibrary)
      .where(
        and(
          isNull(schema.referenceAdLibrary.clientId),
          eq(schema.referenceAdLibrary.isActive, true),
          inArray(
            sql`lower(regexp_replace(${schema.referenceAdLibrary.industry}, '[^a-zA-Z0-9]+', '', 'g'))`,
            normalized
          )
        )
      )
      .orderBy(sql`random()`)
      .limit(1);
    if (byIndustry?.imageUrl) {
      return { imageUrl: byIndustry.imageUrl, name: byIndustry.name, tier: "industry", isShared: true };
    }
  }

  // 4. Shared pool, unfiltered — never block generation.
  const [shared] = await db
    .select({ imageUrl: schema.referenceAdLibrary.imageUrl, name: schema.referenceAdLibrary.name })
    .from(schema.referenceAdLibrary)
    .where(and(isNull(schema.referenceAdLibrary.clientId), eq(schema.referenceAdLibrary.isActive, true)))
    .orderBy(sql`random()`)
    .limit(1);
  if (shared?.imageUrl) {
    return { imageUrl: shared.imageUrl, name: shared.name, tier: "shared", isShared: true };
  }

  return null;
}
