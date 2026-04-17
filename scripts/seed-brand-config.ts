import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

async function main() {
  const brandName = process.argv[2];
  const agent1File = process.argv[3];
  const agent2File = process.argv[4];
  const industries = process.argv[5] || "[]";

  if (!brandName || !agent1File || !agent2File) {
    console.error("Usage: npx tsx scripts/seed-brand-config.ts <brandName> <agent1.txt> <agent2.txt> [industries_json]");
    process.exit(1);
  }

  const agent1Prompt = fs.readFileSync(agent1File, "utf8").trim();
  const agent2Prompt = fs.readFileSync(agent2File, "utf8").trim();

  const [brand] = await sql`SELECT id FROM brands WHERE name = ${brandName} LIMIT 1`;
  if (!brand) {
    console.error(`Brand "${brandName}" not found`);
    process.exit(1);
  }

  await sql`DELETE FROM client_static_ad_config WHERE client_id = ${brand.id}`;
  await sql`INSERT INTO client_static_ad_config (client_id, agent1_prompt, agent2_prompt, allowed_industries, is_active)
    VALUES (${brand.id}, ${agent1Prompt}, ${agent2Prompt}, ${industries}, true)`;

  console.log(`${brandName} config seeded. Agent1: ${agent1Prompt.length} chars, Agent2: ${agent2Prompt.length} chars`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
