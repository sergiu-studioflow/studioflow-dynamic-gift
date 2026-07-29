/**
 * Seed the per-client Quality Control ruleset (compliance_config).
 *
 * Run:  DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-qc-config.ts <client-slug>
 *       DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-qc-config.ts --all
 *
 * Idempotent: ON CONFLICT (client_id) DO UPDATE, bumping `version` each run. The winner
 * profile is NOT touched here — it is derived from the Winners Library, not authored.
 *
 * SOURCE OF TRUTH: the "Creative Constraints & Guardrails" section of each client's Brand
 * Intelligence. Those are the group's own written red lines; this script only translates
 * them into the two forms the gate can act on.
 *
 * TRIAGE RULE (this is the part that keeps the gate from crying wolf):
 *   banned_phrasings → ONLY unambiguous deterministic substring hard-fails (wrong CTA
 *                      domains, brand-name misspellings). A hit here instantly fails
 *                      brand_fit with no judgement involved, so anything subjective here
 *                      would block good work. Never put style rules in this list.
 *   visual_rules     → rules a judge can verify by LOOKING at the piece.
 *   brand_safety_notes → advisory / portfolio-level context. Note that grounding.ts ALREADY
 *                      injects each client's full constraints section automatically, so this
 *                      field is only for what that section does not already say.
 */

import postgres from "postgres";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Group-wide rules. Every brand in the Dynamic Gift portal shares these guardrails
// (verbatim in each client's Brand Intelligence constraints section). Phrased as closed,
// checkable conditions so the judge can only fail on something concrete.
// ---------------------------------------------------------------------------
const GROUP_VISUAL_RULES = [
  "No glitchy or obviously AI-generated output: warped logos, malformed or garbled text, melted hands or faces, impossible geometry. The owner paused all social advertising over glitchy auto-generated ads — this is the zero-tolerance rule.",
  "No bland, directionless 'new product' content. A piece must carry a concrete angle or benefit, not just 'we sell this'.",
  "The value must register within seconds. Fail only if nothing on the piece communicates an offer, benefit or hook — not merely because it is understated.",
  "Australian English only. American spellings (customize, color, personalize, organize, center) in customer-facing copy are a brand_fit fail.",
  "Accurate claims only: do not state prices, turnaround times, minimum order quantities or capabilities that are not supplied in the brief or product facts. An invented specific number is a fail; an absent one is not.",
  "Never name or disparage a competitor. Positioning is by implicit contrast only.",
  "Ads should carry a clear call to action (request a quote / get in touch / browse the range). Treat a missing CTA as an advisory note, not a fail — an otherwise strong creative is not defective for omitting one.",
  "Testimonials and review quotes must be real. Invented customer quotes, star ratings or named clients are a fail.",
];

// ---------------------------------------------------------------------------
// Per-client overrides. `domain` seeds the wrong-CTA-domain red lines.
// ---------------------------------------------------------------------------
type ClientSeed = {
  domain: string;
  /** Extra deterministic hard-fail substrings beyond the auto-generated ones. */
  bannedExtra?: string[];
  /** Extra judge-verifiable rules on top of the group set. */
  rulesExtra?: string[];
  notes?: string;
};

const CLIENTS: Record<string, ClientSeed> = {
  "dynamic-gift": { domain: "dynamicgift.com.au" },
  "event-display": { domain: "eventdisplay.com.au" },

  "indigenous-promotions": {
    domain: "indigenouspromotions.com.au",
    rulesExtra: [
      "CULTURAL SENSITIVITY IS PARAMOUNT and carries reputational risk for the entire parent company. Fail on anything that reads as cultural appropriation: Indigenous artwork, motifs, symbols or dot-painting styles generated or pastiched by AI rather than sourced from the real product, sacred imagery used decoratively, or generic 'tribal' styling not tied to an actual product.",
    ],
    notes:
      "Indigenous Promotions requires extra human scrutiny before publishing regardless of the automated verdict. Brand-specific cultural guidelines are still to be developed in consultation with Chris — until they exist, treat a pass here as 'no defect found', not as cultural sign-off.",
  },

  "inflatable-promotions": {
    domain: "inflatablepromotions.com.au",
    rulesExtra: [
      "Do not misstate compliance or safety specifics — Australian Standards, compliant accessories, engineering assessments. Only claim what the brief verifies; an unverified safety or compliance claim is a fail.",
    ],
  },

  "lanyards-factory": { domain: "lanyardsfactory.com.au" },

  "pin-factory": {
    domain: "thepinfactory.com.au",
    rulesExtra: [
      "This brand carries an Indigenous product range. Any piece featuring it must meet the same cultural-sensitivity bar as Indigenous Promotions: authentic, respectful, no AI-pastiched Indigenous artwork or appropriated motifs.",
    ],
  },

  "promo-superstore": { domain: "promosuperstore.au" },

  "the-cap-company": {
    domain: "thecapcompany.com.au",
    // The brand intel explicitly warns these are DIFFERENT companies whose facts must never
    // be imported. A wrong domain on a CTA is exactly the deterministic error this list is for.
    bannedExtra: ["thecapcompany.com/", "capcompany.co.za", "www.thecapcompany.com "],
    rulesExtra: [
      "Minimum order quantity is UNCONFIRMED — the site contradicts itself (50 pcs vs 25 pcs). Stating a single MOQ figure is a fail.",
      "The only stated turnaround is an indicative '10-14 days*' rush on Trucker Caps, and the Price Beat Guarantee carries an asterisk. Promising a faster turnaround, applying the rush window to all styles, or presenting either claim as unconditional is a fail.",
      "Only the real on-site testimonials may be used (Jayco Bundaberg, One Nation, F45, Surf Life Saving, Amazon). Invented quotes or misattributed reviews are a fail.",
      "Named clients may be referenced only as 'helped create custom caps'. Overstating the relationship is a fail.",
      "Visuals must match the brand's own bar: clean, product-led photography of finished caps with crisp embroidery detail.",
    ],
    notes:
      "There is no formal brand style guide on file — visual guidance is inferred from site assets, so treat visual style as reference rather than a documented standard. The Dynamic Gift International link is inferred, not stated: never attach DGI-specific facts (years in business, revenue, its clients) to The Cap Company.",
  },

  "the-medal-factory": {
    domain: "themedalfactory.com.au",
    rulesExtra: [
      "Only real testimonials from the website may be used — never invent quotes or ratings.",
    ],
  },
};

/**
 * Deterministic red lines derived from the brand's real name + domain:
 *   - the .com / .net / .co variants of the correct domain (wrong CTA destinations)
 *   - the domain with a hyphen inserted, a common generated-text error
 * Kept mechanical on purpose — a hit hard-fails with no judgement, so every entry must be
 * something that is ALWAYS wrong.
 */
function bannedForDomain(domain: string): string[] {
  const bare = domain.replace(/\.com\.au$|\.au$/, "");
  return [`${bare}.com/`, `${bare}.net`, `www.${bare}.com/`];
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx scripts/seed-qc-config.ts <client-slug|--all>");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const slugs = arg === "--all" ? Object.keys(CLIENTS) : [arg];
  const unknown = slugs.filter((s) => !CLIENTS[s]);
  if (unknown.length) {
    console.error(`Unknown slug(s): ${unknown.join(", ")}\nKnown: ${Object.keys(CLIENTS).join(", ")}`);
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

  for (const slug of slugs) {
    const seed = CLIENTS[slug];
    const [brand] = await sql`SELECT id, name FROM brands WHERE slug = ${slug} LIMIT 1`;
    if (!brand) {
      console.warn(`  ⚠ ${slug}: no brand row — skipped`);
      continue;
    }

    const banned = [...bannedForDomain(seed.domain), ...(seed.bannedExtra ?? [])];
    const rules = [
      `Brand name is spelled exactly "${brand.name}". Any other spelling of it on the piece is a fail.`,
      `The only correct CTA domain for this brand is ${seed.domain}.`,
      ...GROUP_VISUAL_RULES,
      ...(seed.rulesExtra ?? []),
    ];

    await sql`
      INSERT INTO compliance_config (client_id, banned_phrasings, visual_rules, palette_hexes, product_facts, brand_safety_notes, version)
      VALUES (${brand.id}, ${sql.json(banned)}, ${sql.json(rules)}, ${sql.json([])}, ${sql.json([])}, ${seed.notes ?? null}, 1)
      ON CONFLICT (client_id) DO UPDATE SET
        banned_phrasings = EXCLUDED.banned_phrasings,
        visual_rules = EXCLUDED.visual_rules,
        brand_safety_notes = EXCLUDED.brand_safety_notes,
        version = compliance_config.version + 1,
        updated_at = now()`;

    console.log(`  ✓ ${slug}: ${rules.length} rules, ${banned.length} red lines`);
  }

  // Palette is left EMPTY on purpose: no brand in this portal has a documented palette
  // (brands.brand_color is null for 8 of 9), and an invented palette would fail every
  // creative on colour. The rubric omits the palette clause entirely when the list is
  // empty — add real hex codes per client in the QC → Rules tab once they are known.
  console.log("\nNote: palette_hexes and product_facts are intentionally empty — fill them in");
  console.log("the Quality Control → Rules tab per client once real values are confirmed.");

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
