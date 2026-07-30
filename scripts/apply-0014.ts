// Apply drizzle/0014_static_ad_prompt_jobs.sql by hand (the drizzle journal is
// stale at 0002 — never run drizzle-kit generate/migrate on this portal).
//
// Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/apply-0014.ts
//
// Idempotent. Prints the per-brand prompt-configuration state afterwards so it's
// obvious which brands still have no Agent 1/2 prompts.

import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

async function main() {
  const migration = readFileSync(join(__dirname, "..", "drizzle", "0014_static_ad_prompt_jobs.sql"), "utf-8");
  console.log("Applying 0014_static_ad_prompt_jobs.sql …");
  await sql.unsafe(migration);
  console.log("Applied.\n");

  const rows = await sql`
    SELECT b.slug,
           (c.client_id IS NOT NULL) AS has_config,
           coalesce(length(c.agent1_prompt), 0) AS a1,
           coalesce(length(c.agent2_prompt), 0) AS a2,
           coalesce((b.settings ->> 'staticAdPromptsArePlaceholder')::boolean, false) AS placeholder
    FROM brands b
    LEFT JOIN client_static_ad_config c ON c.client_id = b.id
    WHERE b.is_active
    ORDER BY b.name`;

  console.log("Agent prompt state per brand:");
  for (const r of rows) {
    const state = !r.has_config ? "NO CONFIG" : r.placeholder ? "placeholder" : "brand-specific";
    console.log(`  ${String(r.slug).padEnd(24)} ${state.padEnd(15)} agent1=${r.a1} agent2=${r.a2}`);
  }

  const jobs = await sql`SELECT status, count(*)::int AS n FROM client_static_ad_prompt_jobs GROUP BY 1 ORDER BY 1`;
  console.log("\nprompt jobs:", jobs.length ? jobs.map((j) => `${j.status}=${j.n}`).join(" ") : "(none yet)");

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch(() => {});
  process.exit(1);
});
