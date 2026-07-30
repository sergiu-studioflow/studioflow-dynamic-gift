/**
 * Static-Ad Prompt Builder — orchestrator.
 *
 * `runFullBuild(ctx)` runs the full pipeline (research → vibe + study →
 * deterministic authoring → contract test + critic) and returns the two
 * brand-specific system prompts plus all intermediates. It is a PURE pipeline —
 * it does not touch the DB. Persistence / job-state / auto-publish live in the
 * API route layer, which can pass an `onStage` callback to checkpoint progress.
 *
 * The deterministic output-contract test is the hard gate: if a draft prompt
 * would break the runtime, `runFullBuild` throws `ContractError` and the caller
 * must NOT overwrite the live placeholder prompts.
 */

import { contractCheckAgent1, contractCheckAgent2 } from "./contract";
import { runCritic } from "./critic";
import {
  assembleAgent1,
  assembleAgent2,
  resolveReferenceImage,
  runResearch,
  runStudy,
  runVibe,
} from "./stages";
import type { BuildContext, BuildResult, ItemStudy, Stage } from "./types";

export class ContractError extends Error {
  constructor(message: string, public sample?: string) {
    super(message);
    this.name = "ContractError";
  }
}

export type { BuildContext, BuildResult } from "./types";
export { resolveReferenceImage } from "./stages";

/** Weak fallback when no reference ad image is available for a live contract test. */
function structuralContractCheck(agent1Prompt: string, agent2Prompt: string): void {
  if (!/Raw JSON only/i.test(agent1Prompt) || !/format_classification/.test(agent1Prompt)) {
    throw new ContractError("Agent 1 prompt is missing the pure-JSON output contract / taxonomy.");
  }
  if (
    !/use the attached images/i.test(agent2Prompt) ||
    !/PART 2|copy_used/.test(agent2Prompt)
  ) {
    throw new ContractError("Agent 2 prompt is missing the prose-then-metadata output contract.");
  }
}

export async function runFullBuild(
  ctx: BuildContext,
  opts?: { onStage?: (stage: Stage) => void | Promise<void> },
): Promise<BuildResult> {
  const onStage = opts?.onStage ?? (() => {});

  // A — Brand DNA research (slow; web + vision).
  await onStage("research");
  const dna = await runResearch(ctx);

  // B + C — vibe pass and item study run concurrently (C doesn't depend on DNA).
  await onStage("vibe");
  const [vibe, items]: [Awaited<ReturnType<typeof runVibe>>, ItemStudy[]] = await Promise.all([
    runVibe(ctx, dna),
    (async () => {
      await onStage("study");
      return runStudy(ctx);
    })(),
  ]);

  // E + F — deterministic authoring (contract-safe slot fills).
  await onStage("author1");
  const agent1Prompt = assembleAgent1(ctx);
  await onStage("author2");
  const agent2Prompt = assembleAgent2(ctx, dna, vibe, items);

  // G — hard contract gate + advisory critic.
  await onStage("critique");
  const referenceImageUrl = resolveReferenceImage(ctx);

  if (referenceImageUrl) {
    const a1 = await contractCheckAgent1(agent1Prompt, referenceImageUrl);
    if (a1.transient) throw new Error(`Contract test could not run: ${a1.error}`);
    if (!a1.ok || !a1.analysisJson) {
      throw new ContractError(`Agent 1 contract failed: ${a1.error}`, a1.sample);
    }
    const firstItem = items[0];
    const a2 = await contractCheckAgent2({
      agent2Prompt,
      analysisJson: a1.analysisJson,
      referenceImageUrl,
      itemName: firstItem?.name || ctx.brandName,
      itemImageUrl: firstItem?.imageUrl ?? ctx.logoUrl ?? null,
    });
    if (a2.transient) throw new Error(`Contract test could not run: ${a2.error}`);
    if (!a2.ok) {
      throw new ContractError(`Agent 2 contract failed: ${a2.error}`, a2.sample);
    }
  } else {
    structuralContractCheck(agent1Prompt, agent2Prompt);
  }

  const criticReport = await runCritic({ agent1Prompt, agent2Prompt, dna, items });

  // NOTE: the donor portal has an extra "brief" stage here that derives a second
  // pair of Brief-Mode prompts. This portal has no Brief tab and no
  // brief_agent*_prompt columns, so that stage is deliberately omitted — it would
  // cost two more Opus calls per run and write nowhere.

  return {
    agent1Prompt,
    agent2Prompt,
    brandDna: dna,
    vibe,
    items,
    criticReport,
  };
}
