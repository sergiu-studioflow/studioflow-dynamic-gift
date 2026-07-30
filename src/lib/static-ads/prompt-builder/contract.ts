/**
 * Static-Ad Prompt Builder — deterministic output-contract test.
 *
 * The hard safety check ahead of review: it live-runs the DRAFT Agent 1 + Agent 2
 * prompts
 * through the EXACT post-processing the runtime applies (`custom-pipeline.ts`)
 * and asserts they satisfy the contract:
 *   - Agent 1 output, after stripping ``` fences, must JSON.parse().
 *   - Agent 2 output must split on the last "\n{" into a non-empty prose prompt
 *     (beginning "Use the attached images") + a parseable metadata block.
 *
 * If either fails, the draft never reaches the review queue — a broken prompt
 * would silently break ad generation for that brand.
 *
 * A failure of the CALL (an overloaded API, a network blip) is reported as
 * `transient` and is NOT a contract violation: the draft may be perfectly good.
 * Conflating the two tells the user their prompts are broken when Anthropic was
 * merely busy.
 */

import { callOpus, imageBlock } from "./claude";

export type ContractResult = {
  ok: boolean;
  error?: string;
  sample?: string;
  /** The API call itself failed — retry, don't blame the draft. */
  transient?: boolean;
};

/** Mirror of custom-pipeline.ts analyzeReferenceAd() post-processing. */
function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  return t;
}

/**
 * Run the draft Agent 1 prompt against a real reference ad and assert the
 * output is valid JSON. Returns the analysis JSON for reuse by the Agent 2 check.
 */
export async function contractCheckAgent1(
  agent1Prompt: string,
  referenceImageUrl: string,
): Promise<ContractResult & { analysisJson?: string }> {
  let raw: string;
  try {
    const block = await imageBlock(referenceImageUrl);
    const { text } = await callOpus({
      system: agent1Prompt,
      messages: [
        {
          role: "user",
          content: [
            block as never,
            { type: "text", text: "Analyse this advertisement image and output the structured JSON description." },
          ],
        },
      ],
      effort: "medium",
      maxTokens: 16000,
    });
    raw = text;
  } catch (err) {
    return { ok: false, transient: true, error: `Agent 1 call failed: ${(err as Error).message}` };
  }

  const cleaned = stripFences(raw);
  try {
    JSON.parse(cleaned);
  } catch {
    return { ok: false, error: "Agent 1 did not return valid JSON.", sample: cleaned.slice(0, 400) };
  }
  return { ok: true, analysisJson: cleaned };
}

/**
 * Run the draft Agent 2 prompt against a sample format brief + item, then apply
 * the runtime's split-on-last-"\n{" and assert a non-empty prompt + parseable
 * metadata come out.
 */
export async function contractCheckAgent2(opts: {
  agent2Prompt: string;
  analysisJson: string;
  referenceImageUrl: string;
  itemName: string;
  itemImageUrl?: string | null;
}): Promise<ContractResult> {
  const userMessage = `Here are the inputs for this ad generation:

FORMAT BRIEF (from Agent 1 analysis):
${opts.analysisJson}

SELECTION:
Name: ${opts.itemName}

USER COPY:
(No copy provided — generate ideal copy for this and the format from Brand DNA)

REQUIRED ASPECT RATIO: 4:5
End your prompt with "Aspect ratio: 4:5".

Write the image generation prompt now.`;

  let raw: string;
  try {
    const refBlock = await imageBlock(opts.referenceImageUrl);
    const content: unknown[] = [refBlock];
    if (opts.itemImageUrl) content.push(await imageBlock(opts.itemImageUrl));
    content.push({ type: "text", text: userMessage });

    const { text } = await callOpus({
      system: opts.agent2Prompt,
      messages: [{ role: "user", content: content as never }],
      effort: "medium",
      maxTokens: 16000,
    });
    raw = text.trim();
  } catch (err) {
    return { ok: false, transient: true, error: `Agent 2 call failed: ${(err as Error).message}` };
  }

  // Mirror generateCustomPrompt() split.
  const lastJsonStart = raw.lastIndexOf("\n{");
  const prompt = lastJsonStart === -1 ? raw : raw.slice(0, lastJsonStart).trim();

  if (!prompt || prompt.length < 80) {
    return { ok: false, error: "Agent 2 produced an empty/too-short prompt.", sample: raw.slice(0, 400) };
  }
  if (!/use the attached images/i.test(prompt.slice(0, 120))) {
    return {
      ok: false,
      error: 'Agent 2 prompt did not begin with "Use the attached images as brand reference."',
      sample: prompt.slice(0, 200),
    };
  }

  if (lastJsonStart !== -1) {
    let metadata = raw.slice(lastJsonStart).trim();
    if (metadata.startsWith("```")) {
      metadata = metadata.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    }
    try {
      JSON.parse(metadata);
    } catch {
      return { ok: false, error: "Agent 2 trailing metadata block is not valid JSON.", sample: metadata.slice(0, 200) };
    }
  }

  return { ok: true, sample: prompt.slice(0, 200) };
}
