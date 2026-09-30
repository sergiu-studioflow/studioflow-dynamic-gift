/**
 * Unified Video Generation Provider
 *
 * Abstracts Muapi and Kie AI behind a single interface.
 * Switch providers via the VIDEO_PROVIDER env var ("muapi" | "kie").
 * Defaults to "muapi" for backward compatibility.
 */

import { submitSeedanceJob, pollSeedanceJob } from "./muapi";
import { submitKieVideoJob, pollKieVideoJob, getKieCredits } from "./kie-video";
import { estimateVideoCredits } from "./video-models";

export type VideoJobInput = {
  prompt: string;
  imageUrls: string[];
  aspectRatio: string;
  duration: number;
  /** Voice reference clip(s) — Kie only; Muapi ignores them. */
  audioUrls?: string[];
  /** video-models.ts id — Kie only. */
  model?: string;
};

export type VideoSubmitResult = {
  requestId: string;
};

export type VideoPollResult = {
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
};

function getProvider(): "muapi" | "kie" {
  const provider = (process.env.VIDEO_PROVIDER || "muapi").trim().toLowerCase();
  if (provider === "kie") return "kie";
  return "muapi";
}

/** Only the Kie client sends reference audio and the Seedance 2.5 model; Muapi would drop both silently. */
export function supportsVoicesAndModels(): boolean {
  return getProvider() === "kie";
}

export async function submitVideoJob(input: VideoJobInput): Promise<VideoSubmitResult> {
  const provider = getProvider();

  if (provider === "kie") {
    return submitKieVideoJob(input);
  }

  return submitSeedanceJob(input);
}

/** Duration + model let a failure message say whether the balance covers the render. */
export async function pollVideoJob(
  requestId: string,
  durationSeconds?: number,
  modelId?: string
): Promise<VideoPollResult> {
  const provider = getProvider();

  if (provider === "kie") {
    return pollKieVideoJob(requestId, durationSeconds, modelId);
  }

  return pollSeedanceJob(requestId);
}

/**
 * Refuse a render the video provider's balance can't pay for BEFORE any paid prompt step
 * runs — otherwise every attempt spends the Claude/GPT steps and only then fails at submit.
 * Returns the user-facing reason, or null to go ahead. An unreadable balance never blocks:
 * the provider's own submit check still applies.
 */
export async function checkVideoBalance(durationSeconds: number, modelId?: string): Promise<string | null> {
  if (getProvider() !== "kie") return null;
  const credits = await getKieCredits();
  const needed = estimateVideoCredits(durationSeconds, modelId);
  if (credits === null || credits >= needed) return null;
  return `Your Kie AI account doesn't have enough credits for this video. Balance: ${Math.floor(credits)} credits; a ${durationSeconds}s video needs about ${needed}. Top up at kie.ai, then generate again. Nothing was run or charged.`;
}
