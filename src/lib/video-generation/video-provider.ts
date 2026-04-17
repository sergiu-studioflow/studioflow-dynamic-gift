/**
 * Unified Video Generation Provider
 *
 * Abstracts Muapi and Kie AI behind a single interface.
 * Switch providers via the VIDEO_PROVIDER env var ("muapi" | "kie").
 * Defaults to "muapi" for backward compatibility.
 */

import { submitSeedanceJob, pollSeedanceJob } from "./muapi";
import { submitKieVideoJob, pollKieVideoJob } from "./kie-video";

export type VideoJobInput = {
  prompt: string;
  imageUrls: string[];
  aspectRatio: string;
  duration: number;
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

export async function submitVideoJob(input: VideoJobInput): Promise<VideoSubmitResult> {
  const provider = getProvider();

  if (provider === "kie") {
    return submitKieVideoJob(input);
  }

  return submitSeedanceJob(input);
}

export async function pollVideoJob(requestId: string): Promise<VideoPollResult> {
  const provider = getProvider();

  if (provider === "kie") {
    return pollKieVideoJob(requestId);
  }

  return pollSeedanceJob(requestId);
}
