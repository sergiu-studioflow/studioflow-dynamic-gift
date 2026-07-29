// Apply drizzle/0012_quality_control.sql by hand (the drizzle journal is stale at 0002 —
// never run drizzle-kit generate/migrate on this portal; hand-written SQL is the pattern).
//
// Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/apply-0012.ts
//
// Idempotent — safe to re-run. Prints the post-apply qc_status distribution for all five
// gated tables so the grandfather backfill can be eyeballed (expect only 'skipped' on
// existing rows, plus 'pending' on anything mid-generation).

import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

const VISUAL_TABLES = ["static_ad_generations", "video_generations"];
const TEXT_TABLES = ["generated_ad_copy", "generated_video_briefs", "content_ideas"];

async function main() {
  const migration = readFileSync(join(__dirname, "..", "drizzle", "0012_quality_control.sql"), "utf-8");
  console.log("Applying 0012_quality_control.sql …");
  await sql.unsafe(migration);
  console.log("Applied.\n");

  for (const table of VISUAL_TABLES) {
    const rows = await sql.unsafe(
      `SELECT qc_status, status, count(*)::int AS n FROM ${table} GROUP BY 1, 2 ORDER BY 1, 2`
    );
    console.log(`${table}:`);
    for (const r of rows) console.log(`  qc=${r.qc_status}  status=${r.status}  n=${r.n}`);
  }
  for (const table of TEXT_TABLES) {
    const rows = await sql.unsafe(`SELECT qc_status, count(*)::int AS n FROM ${table} GROUP BY 1 ORDER BY 1`);
    console.log(`${table}:`);
    for (const r of rows) console.log(`  qc=${r.qc_status}  n=${r.n}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
