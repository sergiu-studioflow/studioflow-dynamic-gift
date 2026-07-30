// Apply drizzle/0013_multi_brand_scaling.sql by hand, then reconcile the shared
// reference library into the database.
//
// Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/apply-0013.ts
//
// WHY THE RECONCILE EXISTS
// ------------------------
// Since commit f98eb5a the reference library has had a split brain: GET and
// /random read an R2 manifest, while POST/PATCH/DELETE write Postgres. Uploads
// and edits were therefore invisible, and per-brand scoping was impossible
// (a client_id column is inert while reads bypass the DB).
//
// The fix is to make the DB the single read path — but the manifest is the
// LARGER corpus (562 shared items vs 123 rows here), so flipping the read path
// without importing first would shrink every brand's pool. This import is
// purely additive and idempotent: it dedupes on airtable_record_id (UNIQUE) and
// falls back to image_url for the handful of manifest items that lack one.
//
// Safe to re-run.

import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

const MANIFEST_URL =
  process.env.REFERENCE_MANIFEST_URL ||
  "https://pub-c85814e28869441d8a619b3b90562166.r2.dev/shared/reference-ad-library/manifest.json";

type ManifestItem = {
  airtableRecordId?: string | null;
  name?: string;
  industry?: string;
  adType?: string | null;
  brand?: string | null;
  tags?: string | null;
  imageUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
};

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

async function main() {
  const migration = readFileSync(join(__dirname, "..", "drizzle", "0013_multi_brand_scaling.sql"), "utf-8");
  console.log("Applying 0013_multi_brand_scaling.sql …");
  await sql.unsafe(migration);
  console.log("Applied.\n");

  // ── Reconcile the shared manifest into the DB ────────────────────────────
  console.log(`Reconciling shared reference library from ${MANIFEST_URL}`);
  let items: ManifestItem[] = [];
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    items = (manifest.items || []).filter((i: ManifestItem) => i.isActive !== false && i.imageUrl);
  } catch (err) {
    console.error(`\n  ✗ Could not read the manifest: ${String(err).slice(0, 160)}`);
    console.error("    The schema change applied, but the read path must NOT be switched to the");
    console.error("    database until this import succeeds — re-run from an environment that can");
    console.error("    reach R2. Aborting so the mismatch is not left silently in place.");
    await sql.end();
    process.exit(1);
  }

  const existing = await sql`SELECT airtable_record_id, image_url FROM reference_ad_library`;
  const byAirtable = new Set(existing.map((r) => r.airtable_record_id).filter(Boolean));
  const byUrl = new Set(existing.map((r) => r.image_url));

  const missing = items.filter(
    (i) => !(i.airtableRecordId && byAirtable.has(i.airtableRecordId)) && !byUrl.has(i.imageUrl!)
  );

  console.log(`  manifest active=${items.length}  already present=${items.length - missing.length}  to import=${missing.length}`);

  let imported = 0;
  for (const i of missing) {
    // client_id stays NULL — these are the SHARED pool. A brand's own
    // references are created through the portal with client_id set.
    const [row] = await sql`
      INSERT INTO reference_ad_library (name, image_url, industry, ad_type, brand, tags, airtable_record_id, is_active, sort_order, client_id)
      VALUES (
        ${i.name || "Untitled"}, ${i.imageUrl!}, ${i.industry || "Other"},
        ${i.adType ?? null}, ${i.brand ?? null}, ${i.tags ?? null},
        ${i.airtableRecordId ?? null}, true, ${i.sortOrder ?? 0}, NULL
      )
      ON CONFLICT (airtable_record_id) DO NOTHING
      RETURNING id`;
    if (row) imported++;
  }
  console.log(`  imported ${imported} shared reference(s).\n`);

  // ── Report ───────────────────────────────────────────────────────────────
  const refs = await sql`
    SELECT CASE WHEN client_id IS NULL THEN 'shared' ELSE 'brand-owned' END AS scope, count(*)::int AS n
    FROM reference_ad_library WHERE is_active GROUP BY 1 ORDER BY 1`;
  console.log("reference_ad_library:");
  for (const r of refs) console.log(`  ${r.scope}: ${r.n}`);

  const tz = await sql`SELECT timezone, count(*)::int AS n FROM scheduled_posts GROUP BY 1 ORDER BY 2 DESC`;
  console.log("scheduled_posts timezone:");
  if (!tz.length) console.log("  (no rows)");
  for (const r of tz) console.log(`  ${r.timezone}: ${r.n}`);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch(() => {});
  process.exit(1);
});
