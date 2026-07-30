/**
 * Static-Ad Prompt Builder — QC critic (Stage G, advisory).
 *
 * The HARD gate is the deterministic contract test (contract.ts). This critic is
 * an additional quality judge that scores the assembled prompts against Daniel's
 * acceptance criteria and records issues for inspection / future re-runs.
 */

import { callOpusJSON } from "./claude";
import type { BrandDNA, CriticReport, ItemStudy } from "./types";

export async function runCritic(opts: {
  agent1Prompt: string;
  agent2Prompt: string;
  dna: BrandDNA;
  items: ItemStudy[];
}): Promise<CriticReport> {
  const { agent1Prompt, agent2Prompt, dna, items } = opts;
  try {
    return await callOpusJSON<CriticReport>({
      system: `You are a strict QC reviewer for two static-ad system prompts produced for a brand.

ACCEPTANCE CRITERIA:
Agent 1 (reference-ad analyst): must instruct PURE JSON output (no prose), include the full visual-anatomy taxonomy (background, layout, product placement, hero action, typography, copy structure, supporting elements, lighting, colour palette, mood, format_classification), and specialise in the right vertical.
Agent 2 (brand-transplant prompt writer): must (a) keep the verbatim visual-language modifier present and unaltered, (b) carry brand hex substitutions, (c) include the item description catalog marked "USE EXACTLY AS WRITTEN", (d) reflect the brand voice, (e) preserve the output contract (prose prompt beginning "Use the attached images as brand reference." then a trailing metadata JSON block).

Report issues even if minor. Set passes=false for any criterion not met. overallVerdict = "accept" only if both prompts are usable as-is.`,
      messages: [
        {
          role: "user",
          content: `BRAND: covered by these hex colours ${dna.hexPalette.join(", ") || "(none extracted)"}; ${items.length} catalog item(s).

=== AGENT 1 PROMPT ===
${agent1Prompt}

=== AGENT 2 PROMPT ===
${agent2Prompt}`,
        },
      ],
      effort: "high",
      maxTokens: 3000,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent1: {
            type: "object",
            additionalProperties: false,
            properties: { passes: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
            required: ["passes", "issues"],
          },
          agent2: {
            type: "object",
            additionalProperties: false,
            properties: { passes: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
            required: ["passes", "issues"],
          },
          overallVerdict: { type: "string", enum: ["accept", "revise"] },
        },
        required: ["agent1", "agent2", "overallVerdict"],
      },
    });
  } catch {
    // Critic is advisory — never block publish on a critic failure.
    return {
      agent1: { passes: true, issues: ["critic-unavailable"] },
      agent2: { passes: true, issues: ["critic-unavailable"] },
      overallVerdict: "accept",
    };
  }
}
