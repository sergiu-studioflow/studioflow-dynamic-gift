/**
 * Verify per-brand reference selection against the live DB, through the real
 * library code.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-reference-scoping.ts
 *
 * SELF-CLEANING: creates one temporary brand-owned reference, asserts the
 * selection order honours it, then deletes it and re-asserts the fallback.
 *
 * Also acts as the regression test for the manifest/DB split brain: it asserts
 * a row written to the database is visible to the read path.
 */

import "dotenv/config";
import { db, schema } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  pickReferenceForClient,
  parseAllowedIndustries,
  allowedIndustriesFor,
  normalizeIndustry,
} from "@/lib/static-ads/reference-selection";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // ── 1. Corpus ────────────────────────────────────────────────────────────
  console.log("1. Library corpus");
  const [shared] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.referenceAdLibrary)
    .where(and(isNull(schema.referenceAdLibrary.clientId), eq(schema.referenceAdLibrary.isActive, true)));
  check("shared pool is populated", shared.n > 0, `${shared.n} shared references`);
  check(
    "shared pool includes the full manifest corpus (>500)",
    shared.n >= 500,
    `${shared.n} — the reconcile in apply-0013 should have imported 562`
  );

  // ── 2. Subject brand ─────────────────────────────────────────────────────
  console.log("\n2. Subject brand");
  const [brand] = await db
    .select({ id: schema.brands.id, name: schema.brands.brandName })
    .from(schema.brands)
    .where(eq(schema.brands.clientSlug, "lanyards-factory"))
    .limit(1);
  if (!brand) throw new Error("lanyards-factory not found");
  console.log(`  using ${brand.name} (${brand.id})`);

  const winners = await db
    .select({ id: schema.winnersLibrary.id })
    .from(schema.winnersLibrary)
    .where(and(eq(schema.winnersLibrary.clientId, brand.id), eq(schema.winnersLibrary.isActive, true)));
  console.log(`  winners: ${winners.length}`);

  // ── 3. Fallback with no brand-owned references ───────────────────────────
  console.log("\n3. With no brand-owned references");
  const own = await db
    .select({ id: schema.referenceAdLibrary.id })
    .from(schema.referenceAdLibrary)
    .where(eq(schema.referenceAdLibrary.clientId, brand.id));
  check("brand starts with no own references", own.length === 0, `${own.length}`);

  const before = await pickReferenceForClient(brand.id, { includeWinners: false });
  check("still returns a reference (generation never blocks)", !!before);
  check("and reports it as shared", before?.isShared === true, `tier=${before?.tier}`);

  // ── 4. Brand-owned reference wins ────────────────────────────────────────
  console.log("\n4. With a brand-owned reference");
  const [temp] = await db
    .insert(schema.referenceAdLibrary)
    .values({
      clientId: brand.id,
      name: "__verify-scoping temp__",
      imageUrl: "https://example.invalid/verify-scoping.png",
      industry: "Verification",
      isActive: true,
    })
    .returning({ id: schema.referenceAdLibrary.id });

  try {
    // 10 draws: a brand with exactly one own reference must return it every time.
    const picks = [];
    for (let i = 0; i < 10; i++) picks.push(await pickReferenceForClient(brand.id, { includeWinners: false }));
    const allOwn = picks.every((p) => p?.imageUrl === "https://example.invalid/verify-scoping.png");
    check("own reference wins over the shared pool, every draw", allOwn);
    check("and is reported as NOT shared", picks[0]?.isShared === false, `tier=${picks[0]?.tier}`);
    check(
      "DB write is visible to the read path (split-brain regression)",
      picks[0]?.name === "__verify-scoping temp__"
    );

    // Winners outrank references when enabled.
    if (winners.length) {
      const withWinners = await pickReferenceForClient(brand.id, { includeWinners: true });
      check("winners still outrank references", withWinners?.tier === "winner", `tier=${withWinners?.tier}`);
    } else {
      console.log("  – winners precedence not exercised (brand has none)");
    }
  } finally {
    await db.delete(schema.referenceAdLibrary).where(eq(schema.referenceAdLibrary.id, temp.id));
  }

  // ── 5. Cleanup + industry filter ─────────────────────────────────────────
  console.log("\n5. Cleanup and industry filter");
  const after = await db
    .select({ id: schema.referenceAdLibrary.id })
    .from(schema.referenceAdLibrary)
    .where(eq(schema.referenceAdLibrary.clientId, brand.id));
  check("temp reference removed", after.length === 0);

  const restored = await pickReferenceForClient(brand.id, { includeWinners: false });
  check("falls back to shared again", restored?.isShared === true, `tier=${restored?.tier}`);

  check("allowedIndustries parses a JSON array", parseAllowedIndustries('["Apparel","Pets"]').length === 2);
  check("allowedIndustries tolerates junk", parseAllowedIndustries("not json").length === 0);
  // The industry tier can only fire when a brand's allow-list actually names
  // industries present in the shared corpus. Assert the correct branch for the
  // data as it stands, and report the mismatch rather than silently passing.
  const industries = await allowedIndustriesFor(brand.id);
  console.log(`  ${brand.name} allowedIndustries: ${industries.length ? industries.join(", ") : "(none set)"}`);

  const corpus = await db
    .selectDistinct({ industry: schema.referenceAdLibrary.industry })
    .from(schema.referenceAdLibrary)
    .where(and(isNull(schema.referenceAdLibrary.clientId), eq(schema.referenceAdLibrary.isActive, true)));
  const corpusKeys = new Set(corpus.map((r) => normalizeIndustry(r.industry)));
  const overlap = industries.filter((i) => corpusKeys.has(normalizeIndustry(i)));

  const picked = await pickReferenceForClient(brand.id, { includeWinners: false });
  if (overlap.length) {
    check("industry-filtered fallback used", picked?.tier === "industry", `matched: ${overlap.join(", ")}`);
  } else {
    check(
      "falls through to the unfiltered pool when no allowed industry exists in the corpus",
      picked?.tier === "shared",
      `tier=${picked?.tier}`
    );
    console.log(
      `  ⚠ ACTION: none of this brand's allowed industries exist in the library, so the
` +
        `    industry tier is inert. Library vocabulary: ${[...corpusKeys].length} values, e.g.
` +
        `    ${corpus.slice(0, 8).map((r) => r.industry).join(", ")}.
` +
        `    Set allowedIndustries to values from that list (or curate brand-owned references).`
    );
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
