import postgres from "postgres";
import * as fs from "fs";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const [brandName, agent1File, agent2File, industries = "[]"] = args.filter((a) => a !== "--replace");

  if (!brandName || !agent1File || !agent2File) {
    console.error("Usage: npx tsx scripts/seed-brand-config.ts <brandName> <agent1.txt> <agent2.txt> [industries_json] [--replace]");
    process.exit(1);
  }

  const agent1Prompt = fs.readFileSync(agent1File, "utf8").trim();
  const agent2Prompt = fs.readFileSync(agent2File, "utf8").trim();

  const [brand] = await sql`SELECT id, settings FROM brands WHERE name = ${brandName} LIMIT 1`;
  if (!brand) {
    console.error(`Brand "${brandName}" not found`);
    process.exit(1);
  }

  const [live] = await sql`SELECT agent1_prompt, agent2_prompt, updated_at FROM client_static_ad_config WHERE client_id = ${brand.id} LIMIT 1`;
  if (live && !replace) {
    console.error(`${brandName} already has live static-ad prompts. Re-run with --replace to keep a restorable snapshot and overwrite them.`);
    process.exit(1);
  }

  await sql.begin(async (transaction) => {
    // postgres-js types drop TransactionSql's call signature; at runtime it is callable like sql.
    const tx = transaction as unknown as typeof sql;
    // Same snapshot the portal's publish/restore takes, so the Ad Prompts panel can restore these.
    if (live?.agent1_prompt?.trim() && live.agent2_prompt?.trim()) {
      const wasPlaceholder = (brand.settings as { staticAdPromptsArePlaceholder?: unknown } | null)?.staticAdPromptsArePlaceholder === true;
      await tx`INSERT INTO client_static_ad_prompt_jobs (client_id, status, agent1_prompt, agent2_prompt, brand_dna, published_at, completed_at, triggered_by)
        SELECT ${brand.id}, 'snapshot', ${live.agent1_prompt}, ${live.agent2_prompt}, ${tx.json({ snapshot: { wasPlaceholder } })}, ${live.updated_at}, now(), 'seed-brand-config'
        WHERE NOT EXISTS (SELECT 1 FROM client_static_ad_prompt_jobs WHERE client_id = ${brand.id} AND status = 'snapshot'
          AND agent1_prompt = ${live.agent1_prompt} AND agent2_prompt = ${live.agent2_prompt})`;
    }
    await tx`DELETE FROM client_static_ad_config WHERE client_id = ${brand.id}`;
    await tx`INSERT INTO client_static_ad_config (client_id, agent1_prompt, agent2_prompt, allowed_industries, is_active)
      VALUES (${brand.id}, ${agent1Prompt}, ${agent2Prompt}, ${industries}, true)`;
  });

  console.log(`${brandName} config seeded. Agent1: ${agent1Prompt.length} chars, Agent2: ${agent2Prompt.length} chars`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
