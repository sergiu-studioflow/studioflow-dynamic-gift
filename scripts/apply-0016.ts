// Apply drizzle/0016_video_voices.sql by hand (the drizzle journal is
// stale at 0002 — never run drizzle-kit generate/migrate on this portal).
//
// Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/apply-0016.ts
//
// Idempotent. Confirms the table and columns exist afterwards.

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
  const migration = readFileSync(join(__dirname, "..", "drizzle", "0016_video_voices.sql"), "utf-8");
  console.log("Applying 0016_video_voices.sql …");
  await sql.unsafe(migration);

  const cols = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name = 'video_generations' AND column_name IN ('voice_id', 'video_model'))
       OR (table_name = 'video_voices' AND column_name = 'preview_url')`;
  if (cols.length !== 3) throw new Error(`expected 3 columns after migration, found ${cols.length}`);
  console.log("Applied: video_voices table + video_generations.voice_id / video_model.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
