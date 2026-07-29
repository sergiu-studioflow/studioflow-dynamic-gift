// Judge transport dispatcher. The rubric (prompts.ts) is model-agnostic — only the
// transport differs, so every grader calls through here.
//
// Gemini is PRIMARY: it is cheaper and it is the only one of the two that can read a video
// (whole-clip artifact scan + audio track for lip-sync). Dynamic Gift's vault has no Gemini
// key on day one, so:
//
//   images + text → Gemini if configured, else Claude vision/text (ANTHROPIC_API_KEY is
//                   already in the vault, so statics and copy grade from the start).
//   video         → Gemini ONLY. With no Gemini key there is no fallback, so we return
//                   available:false and the scorecard flags the clip for a human review.
//                   We never auto-approve something we could not actually look at.

import { geminiConfigured, gradeVisual, gradeText as gradeTextWithGemini, fetchAsset } from "./gemini";
import { claudeConfigured, gradeImageWithClaude, gradeTextWithClaude } from "./claude";

export { fetchAsset };

/**
 * "Is a judge configured?" has to be answered carefully.
 *
 * getApiKey() reads the encrypted vault table and, by design, SWALLOWS database errors —
 * it returns "" for both "no key stored" and "the read failed". Those two mean opposite
 * things here: the first is a real configuration gap, the second is a transient blip. If we
 * treat a blip as "no judge configured", one bad moment on a shared Neon compute flags an
 * entire cron batch as ungradeable, and a human has to clear dozens of creatives that were
 * never actually inspected.
 *
 * So: once a provider has been seen configured in this process, a later empty read is
 * treated as TRANSIENT (thrown, so the pipeline requeues and retries) rather than as an
 * absence. Only a provider never seen configured reports as genuinely unavailable.
 */
const everSeen = { gemini: false, claude: false };

class TransientConfigError extends Error {
  status = 503; // isTransient() treats >=500 as retryable
  constructor(provider: string) {
    super(`${provider} key temporarily unreadable (vault read failed) — requeueing`);
    this.name = "TransientConfigError";
  }
}

async function isConfigured(provider: "gemini" | "claude"): Promise<boolean> {
  const configured = provider === "gemini" ? await geminiConfigured() : await claudeConfigured();
  if (configured) {
    everSeen[provider] = true;
    return true;
  }
  if (everSeen[provider]) throw new TransientConfigError(provider);
  return false;
}

export type JudgeResult = {
  /** false = we could not grade at all → caller flags for a human, never auto-approves. */
  available: boolean;
  text: string;
  costCents: number;
  provider: "gemini" | "claude" | "none";
};

const UNAVAILABLE: JudgeResult = { available: false, text: "", costCents: 0, provider: "none" };

export type ProviderStatus = { gemini: boolean; claude: boolean; videoGradable: boolean; anyGradable: boolean };

/** Which judges are reachable — drives the dashboard's configuration banner. */
export async function providerStatus(): Promise<ProviderStatus> {
  // Display-only probe for the dashboard banner — plain reads, never throws.
  const [gemini, claude] = await Promise.all([geminiConfigured(), claudeConfigured()]);
  if (gemini) everSeen.gemini = true;
  if (claude) everSeen.claude = true;
  return { gemini, claude, videoGradable: gemini, anyGradable: gemini || claude };
}

/**
 * Grade a visual asset. Reference images are attached BEFORE the graded asset by both
 * transports, matching the rubric's "the LAST attachment is the creative you are grading".
 * Throws on transient/API errors so the pipeline can retry; returns available:false only
 * when no judge can handle this asset kind at all.
 */
export async function judgeVisual(opts: {
  system: string;
  prompt: string;
  asset: { kind: "image" | "video"; url: string };
  referenceImages?: string[];
  prefetched?: { buffer: Buffer; contentType: string };
  maxTokens?: number;
}): Promise<JudgeResult> {
  if (await isConfigured("gemini")) {
    const out = await gradeVisual(opts);
    return { available: true, ...out, provider: "gemini" };
  }

  // No Gemini. Video has no fallback — Claude accepts no video input.
  if (opts.asset.kind === "video") return UNAVAILABLE;

  if (await isConfigured("claude")) {
    const out = await gradeImageWithClaude({
      system: opts.system,
      prompt: opts.prompt,
      imageUrl: opts.asset.url,
      referenceImages: opts.referenceImages,
      maxTokens: opts.maxTokens,
    });
    return { available: true, ...out, provider: "claude" };
  }

  return UNAVAILABLE;
}

/** Grade text-only output (ad copy, briefs, ideas). Either judge can do this. */
export async function judgeText(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<JudgeResult> {
  if (await isConfigured("gemini")) {
    const out = await gradeTextWithGemini(opts);
    return { available: true, ...out, provider: "gemini" };
  }
  if (await isConfigured("claude")) {
    const out = await gradeTextWithClaude(opts);
    return { available: true, ...out, provider: "claude" };
  }
  return UNAVAILABLE;
}
