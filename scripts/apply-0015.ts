// Apply drizzle/0015_video_provider_input.sql by hand (the drizzle journal is
// stale at 0002 — never run drizzle-kit generate/migrate on this portal).
//
// Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/apply-0015.ts
//
// Idempotent. Confirms the column exists afterwards.

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
  const migration = readFileSync(join(__dirname, "..", "drizzle", "0015_video_provider_input.sql"), "utf-8");
  console.log("Applying 0015_video_provider_input.sql …");
  await sql.unsafe(migration);

  const [col] = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'video_generations' AND column_name = 'provider_input'`;
  if (!col) throw new Error("provider_input column missing after migration");
  console.log(`Applied: video_generations.provider_input is ${col.data_type}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
