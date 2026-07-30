/**
 * Verify DB-derived system gating against the live data, through the real
 * library code.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-capabilities.ts
 *
 * READ-ONLY. Prints the per-brand verdict alongside the underlying counts so a
 * wrong verdict is obvious rather than merely asserted, and fails if any brand
 * regressed against what the old hardcoded slug lists showed.
 */

import "dotenv/config";
import { db, schema } from "@/lib/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { capabilitiesForClient } from "@/lib/client-capabilities";

// What the hardcoded arrays in portal-sidebar.tsx used to show. Any brand where
// the new verdict differs is reported explicitly — the lists were hand-kept and
// could show a brand a system that hard-fails for it, so a difference is not
// automatically a regression, but it must never pass unnoticed.
const LEGACY_FULL = [
  "dynamic-gift",
  "event-display",
  "indigenous-promotions",
  "inflatable-promotions",
  "lanyards-factory",
  "pin-factory",
  "promo-superstore",
  "the-medal-factory",
];

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const brands = await db
    .select({
      id: schema.brands.id,
      slug: schema.brands.clientSlug,
      name: schema.brands.brandName,
      reviewsEnabled: schema.brands.reviewsEnabled,
      googleMapsUrl: schema.brands.googleMapsUrl,
    })
    .from(schema.brands)
    .where(eq(schema.brands.isActive, true))
    .orderBy(schema.brands.brandName);

  console.log(`1. Per-brand verdicts (${brands.length} active brands)\n`);
  const n = sql<number>`count(*)::int`;
  const results: Array<{ slug: string; caps: Awaited<ReturnType<typeof capabilitiesForClient>> }> = [];

  for (const b of brands) {
    const caps = await capabilitiesForClient(b.id);
    results.push({ slug: b.slug ?? "", caps });

    const [[cfg], [withImage], [products], [competitors]] = await Promise.all([
      db.select({ n }).from(schema.clientStaticAdConfig).where(eq(schema.clientStaticAdConfig.clientId, b.id)),
      db
        .select({ n })
        .from(schema.clientProducts)
        .where(and(eq(schema.clientProducts.clientId, b.id), isNotNull(schema.clientProducts.imageUrl))),
      db.select({ n }).from(schema.clientProducts).where(eq(schema.clientProducts.clientId, b.id)),
      db.select({ n }).from(schema.clientCompetitors).where(eq(schema.clientCompetitors.clientId, b.id)),
    ]);

    const on = Object.entries(caps)
      .filter(([k, v]) => k !== "reasons" && v === true)
      .map(([k]) => k);
    console.log(`  ${b.name}`);
    console.log(
      `    counts: config=${cfg.n} products=${products.n} withImage=${withImage.n} competitors=${competitors.n} ` +
        `reviewsEnabled=${b.reviewsEnabled} maps=${b.googleMapsUrl ? "yes" : "no"}`
    );
    console.log(`    on:     ${on.join(", ") || "(none)"}`);
    for (const [k, why] of Object.entries(caps.reasons)) console.log(`    off:    ${k} — ${why}`);

    // The endpoint's verdict must match the raw counts it claims to derive from.
    check(
      `${b.name}: staticAds verdict matches its inputs`,
      caps.staticAds === (cfg.n > 0 && withImage.n > 0),
      `staticAds=${caps.staticAds}`
    );
    check(
      `${b.name}: every off system states a reason`,
      Object.entries(caps).every(([k, v]) => k === "reasons" || v === true || !!caps.reasons[k])
    );
    console.log("");
  }

  // ── 2. Diff against the old hardcoded lists ──────────────────────────────
  console.log("2. Diff vs the hardcoded slug lists");
  const changed: string[] = [];
  for (const slug of LEGACY_FULL) {
    const r = results.find((x) => x.slug === slug);
    if (!r) {
      check(`${slug} still exists`, false);
      continue;
    }
    // A brand keeps Static Ads iff it can actually generate one. The generate
    // route requires a productId whose product has an imageUrl (400 otherwise),
    // so "shown but unusable" is the state being corrected, not preserved.
    const [cfg] = await db
      .select({ n })
      .from(schema.clientStaticAdConfig)
      .where(eq(schema.clientStaticAdConfig.clientId, brands.find((b) => b.slug === slug)!.id));
    const [withImage] = await db
      .select({ n })
      .from(schema.clientProducts)
      .where(
        and(
          eq(schema.clientProducts.clientId, brands.find((b) => b.slug === slug)!.id),
          isNotNull(schema.clientProducts.imageUrl)
        )
      );
    const canReallyProduce = cfg.n > 0 && withImage.n > 0;
    check(`${slug}: Static Ads shown iff it can actually generate one`, r.caps.staticAds === canReallyProduce);
    check(`${slug} keeps Video`, r.caps.video);
    if (!r.caps.staticAds) changed.push(slug);
  }
  if (changed.length) {
    console.log(
      `\n  ⚠ CHANGE: ${changed.join(", ")} will no longer show Static Ad System.\n` +
        `    Reason: no product has an image, and /api/static-ads/generate/custom rejects that\n` +
        `    with 400 before it calls a model — the nav item was a dead end. Adding one product\n` +
        `    image on the brand's Products tab turns it back on with no code change.`
    );
  }

  // ── 3. The Cap Company — the brand the lists excluded ─────────────────────
  console.log("\n3. The Cap Company (added by the client, excluded by the old lists)");
  const cap = results.find((x) => x.slug === "the-cap-company");
  if (!cap) {
    check("the-cap-company exists", false);
  } else {
    check("Post Scheduler is reachable (setup surface, never gated)", cap.caps.posting);
    check("Competitor Research is reachable (setup surface, never gated)", cap.caps.research);
    console.log(
      `  – Static Ads: ${cap.caps.staticAds ? "ON" : `off — ${cap.caps.reasons.staticAds}`}\n` +
        `  – it will turn on by itself once that is fixed; no code change, no redeploy.`
    );
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
