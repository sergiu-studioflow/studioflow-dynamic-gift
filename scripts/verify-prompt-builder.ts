/**
 * Run ONE real Static-Ad Prompt Builder job end to end against the live DB and
 * the live Anthropic API, then assert the safety properties that matter.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-prompt-builder.ts [slug]
 *      (defaults to the-cap-company)
 *
 * COSTS REAL MONEY — roughly 8 + N Opus calls with web search and vision, a few
 * minutes of wall clock. It is a one-time-per-brand action, not a cron.
 *
 * The assertions are about the FIXED-prompt safety contract:
 *   1. a completed build parks at `awaiting_review`, with both prompts present;
 *   2. client_static_ad_config is BYTE-IDENTICAL before and after the build —
 *      running the builder must never change a brand's live prompts;
 *   3. only publishing changes them, and it also flips the placeholder flag.
 *
 * Publishing is left in place when the target brand had no prompts at all (the
 * whole point — the brand becomes usable). If the brand already had prompts, the
 * script restores them exactly and reports that it did.
 */

import "dotenv/config";
import { db, schema } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { executePromptJob, publishJob } from "@/lib/static-ads/prompt-builder/job-runner";

const SLUG = process.argv[2] || "the-cap-company";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function liveConfig(clientId: string) {
  const [row] = await db
    .select({
      agent1Prompt: schema.clientStaticAdConfig.agent1Prompt,
      agent2Prompt: schema.clientStaticAdConfig.agent2Prompt,
      updatedAt: schema.clientStaticAdConfig.updatedAt,
    })
    .from(schema.clientStaticAdConfig)
    .where(eq(schema.clientStaticAdConfig.clientId, clientId))
    .limit(1);
  return row ?? null;
}

async function main() {
  const [brand] = await db
    .select({ id: schema.brands.id, name: schema.brands.brandName, settings: schema.brands.settings })
    .from(schema.brands)
    .where(eq(schema.brands.clientSlug, SLUG))
    .limit(1);
  if (!brand) throw new Error(`${SLUG} not found`);
  console.log(`Target: ${brand.name} (${SLUG})\n`);

  // ── 1. Snapshot the live prompts ─────────────────────────────────────────
  console.log("1. Before the build");
  const before = await liveConfig(brand.id);
  const hadPrompts = !!before;
  console.log(
    `  live config: ${
      hadPrompts ? `present (agent1=${before!.agent1Prompt.length}, agent2=${before!.agent2Prompt.length})` : "NONE"
    }`
  );

  // ── 2. Run one real job ──────────────────────────────────────────────────
  console.log("\n2. Running a real build (several minutes)…");
  const [job] = await db
    .insert(schema.clientStaticAdPromptJobs)
    .values({ clientId: brand.id, status: "pending", brandType: "products", triggeredBy: null })
    .returning({ id: schema.clientStaticAdPromptJobs.id });

  const t0 = Date.now();
  await executePromptJob(job.id);
  const elapsed = Math.round((Date.now() - t0) / 1000);

  const [done] = await db
    .select()
    .from(schema.clientStaticAdPromptJobs)
    .where(eq(schema.clientStaticAdPromptJobs.id, job.id))
    .limit(1);

  console.log(`  finished in ${elapsed}s — status=${done.status} stage=${done.stage}`);
  if (done.errorMessage) console.log(`  error: ${done.errorMessage}`);

  check("job reached awaiting_review", done.status === "awaiting_review", `status=${done.status}`);
  check("attempt was counted", (done.attempts ?? 0) === 1, `attempts=${done.attempts}`);
  if (done.status !== "awaiting_review") {
    console.log(`\n${failures} CHECK(S) FAILED — build did not complete, nothing published.`);
    process.exit(1);
  }

  const a1 = done.agent1Prompt ?? "";
  const a2 = done.agent2Prompt ?? "";
  check("Agent 1 draft is substantial", a1.length >= 2000, `${a1.length} chars`);
  check("Agent 2 draft is substantial", a2.length >= 6000, `${a2.length} chars`);
  check("Agent 1 keeps the pure-JSON output contract", /Raw JSON only/i.test(a1) && /format_classification/.test(a1));
  check("Agent 2 keeps the image-prompt output contract", /use the attached images/i.test(a2));
  check("Brand DNA captured", !!(done.brandDna as { document?: string } | null)?.document);
  const critic = done.criticReport as { overallVerdict?: string } | null;
  console.log(`  critic verdict: ${critic?.overallVerdict ?? "(unavailable)"}`);

  // ── 3. THE safety property: the build changed nothing live ───────────────
  console.log("\n3. Live prompts untouched by the build");
  const mid = await liveConfig(brand.id);
  if (hadPrompts) {
    check("agent1Prompt is byte-identical", mid?.agent1Prompt === before!.agent1Prompt);
    check("agent2Prompt is byte-identical", mid?.agent2Prompt === before!.agent2Prompt);
  } else {
    check("still no live config before publish", mid === null);
  }

  // ── 4. Publish, and assert it is the thing that changes them ─────────────
  console.log("\n4. Publishing");
  const ok = await publishJob(brand.id, job.id);
  check("publishJob succeeded", ok);
  const after = await liveConfig(brand.id);
  check("live agent1Prompt now matches the draft", after?.agent1Prompt === a1);
  check("live agent2Prompt now matches the draft", after?.agent2Prompt === a2);

  const [brandAfter] = await db
    .select({ settings: schema.brands.settings })
    .from(schema.brands)
    .where(eq(schema.brands.id, brand.id))
    .limit(1);
  check(
    "placeholder flag flipped false",
    (brandAfter.settings as Record<string, unknown>)?.staticAdPromptsArePlaceholder === false
  );

  const [dnaSection] = await db
    .select({ len: schema.clientBrandIntelligence.content })
    .from(schema.clientBrandIntelligence)
    .where(
      and(
        eq(schema.clientBrandIntelligence.clientId, brand.id),
        eq(schema.clientBrandIntelligence.sectionType, "brand_dna")
      )
    )
    .limit(1);
  check("Brand DNA saved to brand intelligence", !!dnaSection?.len, `${dnaSection?.len?.length ?? 0} chars`);

  const [published] = await db
    .select({ status: schema.clientStaticAdPromptJobs.status })
    .from(schema.clientStaticAdPromptJobs)
    .where(eq(schema.clientStaticAdPromptJobs.id, job.id))
    .limit(1);
  check("job marked published", published.status === "published");

  // ── 5. Restore, if this brand already had prompts ────────────────────────
  if (hadPrompts) {
    console.log("\n5. Restoring the brand's prior prompts (it already had real ones)");
    await db
      .update(schema.clientStaticAdConfig)
      .set({ agent1Prompt: before!.agent1Prompt, agent2Prompt: before!.agent2Prompt, updatedAt: before!.updatedAt })
      .where(eq(schema.clientStaticAdConfig.clientId, brand.id));
    const restored = await liveConfig(brand.id);
    check("prior prompts restored byte-for-byte", restored?.agent1Prompt === before!.agent1Prompt);
    console.log(`  the draft is still on job ${job.id} and can be published from the UI.`);
  } else {
    console.log("\n5. Left published — this brand had no prompts, which is the gap this closes.");
  }

  const [latest] = await db
    .select({ id: schema.clientStaticAdPromptJobs.id })
    .from(schema.clientStaticAdPromptJobs)
    .where(eq(schema.clientStaticAdPromptJobs.clientId, brand.id))
    .orderBy(desc(schema.clientStaticAdPromptJobs.createdAt))
    .limit(1);
  console.log(`\njob: ${latest.id}`);
  console.log(`${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
