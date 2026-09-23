/**
 * Kie AI Seedance 2 Video client.
 * Separate from kie-ai.ts (which handles Nano Banana 2 image generation).
 *
 * Submit: POST /api/v1/jobs/createTask  (model: "bytedance/seedance-2")
 * Poll:   GET  /api/v1/jobs/recordInfo?taskId=...
 */

import { getApiKey as getConfiguredKey } from "@/lib/api-keys";

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";
const KIE_CREDIT_URL = "https://api.kie.ai/api/v1/chat/credit";

/**
 * Seedance 2 at 720p with audio, as Kie actually billed it: 15 s = 615 credits, 4 s = 164.
 * Used for the pre-flight balance check and to tell the user what a render needs.
 */
const SEEDANCE_CREDITS_PER_SECOND = 41;

export function estimateSeedanceCredits(durationSeconds: number): number {
  return Math.ceil(durationSeconds * SEEDANCE_CREDITS_PER_SECOND);
}

async function getApiKey(): Promise<string> {
  const key = await getConfiguredKey("KIE_AI_API_KEY");
  if (!key) throw new Error("KIE_AI_API_KEY is not configured");
  return key;
}

/**
 * The Kie AI account's current credit balance, or null when it can't be read
 * (network error, bad key). Callers must treat null as "unknown", never as zero.
 */
export async function getKieCredits(): Promise<number | null> {
  try {
    const res = await fetch(KIE_CREDIT_URL, {
      headers: { Authorization: `Bearer ${await getApiKey()}` },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    return json.code === 200 && typeof json.data === "number" ? json.data : null;
  } catch {
    return null;
  }
}

const BALANCE_WORDS = /balance|credit|top ?up/i;

/**
 * Kie reports two different "not enough balance" failures, and they mean opposite things:
 *
 * - At submit (createTask) Kie checks the account's OWN credits. A refusal there means the
 *   client's Kie account is genuinely short — say so, with the balance and what's needed.
 * - After a task was accepted, a failure like `failCode 605 "Your balance is insufficient"`
 *   in 0–1 s with 0 credits consumed comes from Kie's upstream (ByteDance), not from the
 *   client: the submit-time check already passed. Shown verbatim, it sent Dynamic Gift
 *   hunting for a top-up on 22 Sep 2026 while their Kie account held 2,383 credits.
 */
async function describeSubmitRefusal(msg: string, durationSeconds: number): Promise<string> {
  if (!BALANCE_WORDS.test(msg)) return `Kie AI refused the video job: ${msg}`;
  const credits = await getKieCredits();
  const needed = estimateSeedanceCredits(durationSeconds);
  const balance = credits === null ? "" : ` Balance: ${Math.floor(credits)} credits;`;
  return `Your Kie AI account doesn't have enough credits for this video.${balance} a ${durationSeconds}s video needs about ${needed}. Top up at kie.ai, then retry the render.`;
}

async function describeTaskFailure(
  failCode: string | number | undefined,
  failMsg: string | undefined,
  creditsConsumed: number | undefined,
  durationSeconds: number | undefined
): Promise<string> {
  const code = failCode ? ` (code ${failCode})` : "";
  const detail = failMsg || "Video generation failed";
  if (!BALANCE_WORDS.test(detail)) return `Kie AI video render failed${code}: ${detail}`;
  const quoted = `"${detail.replace(/[.\s]+$/, "")}"`;

  const credits = await getKieCredits();
  const needed = durationSeconds ? estimateSeedanceCredits(durationSeconds) : null;
  if (credits !== null && needed !== null && credits < needed) {
    return `Your Kie AI account doesn't have enough credits for this video. Balance: ${Math.floor(credits)} credits; a ${durationSeconds}s video needs about ${needed}. Top up at kie.ai, then retry the render.`;
  }
  const charged = creditsConsumed ? "" : " Nothing was charged.";
  const balance = credits === null ? "" : ` Your Kie AI balance is ${Math.floor(credits)} credits, so this is not your account.`;
  return `Kie AI's video service failed this job on its side${code}: ${quoted}.${balance}${charged} This is usually a temporary Kie outage; retry the render in a few minutes.`;
}

export type KieVideoJobInput = {
  prompt: string;
  imageUrls: string[];
  aspectRatio: string;
  duration: number;
};

export type KieVideoSubmitResult = {
  requestId: string;
};

export type KieVideoPollResult = {
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
};

export async function submitKieVideoJob({
  prompt,
  imageUrls,
  aspectRatio,
  duration,
}: KieVideoJobInput): Promise<KieVideoSubmitResult> {
  const apiKey = await getApiKey();
  // Bounded: a hung submit would otherwise hold a claimed retry row until the function dies.
  const res = await fetch(`${KIE_API_BASE}/createTask`, {
    signal: AbortSignal.timeout(60_000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "bytedance/seedance-2",
      input: {
        prompt,
        reference_image_urls: imageUrls.length > 0 ? imageUrls : undefined,
        aspect_ratio: aspectRatio,
        duration,
        resolution: "720p",
        generate_audio: true,
        web_search: false,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 402) throw new Error(await describeSubmitRefusal(text, duration));
    throw new Error(`Kie AI video submit failed (${res.status}): ${text}`);
  }

  const json = await res.json();

  if (json.code !== 200 && json.code !== 0) {
    const msg = json.msg || JSON.stringify(json);
    if (json.code === 402 || BALANCE_WORDS.test(msg)) throw new Error(await describeSubmitRefusal(msg, duration));
    throw new Error(`Kie AI video submit error: ${msg}`);
  }

  const taskId = json.data?.taskId ?? json.taskId;
  if (!taskId) {
    throw new Error(`Kie AI video submit: no taskId in response: ${JSON.stringify(json)}`);
  }

  return { requestId: taskId };
}

export async function pollKieVideoJob(
  requestId: string,
  durationSeconds?: number
): Promise<KieVideoPollResult> {
  const apiKey = await getApiKey();
  const res = await fetch(
    `${KIE_API_BASE}/recordInfo?taskId=${encodeURIComponent(requestId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kie AI video poll failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const data = json.data || {};
  const state = (data.state || "").toLowerCase();

  // Parse result URLs
  let videoUrl: string | undefined;
  if (data.resultJson) {
    try {
      const parsed = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
      const urls = parsed.resultUrls || [];
      if (urls.length > 0 && urls[0].length > 0) {
        videoUrl = urls[0];
      }
    } catch {
      // resultJson might not be valid JSON
    }
  }

  // Map states
  if (state === "success" || state === "completed") {
    if (!videoUrl) {
      return { status: "failed", error: "Video completed but no output URL" };
    }
    return { status: "completed", videoUrl };
  }

  if (state === "failed" || state === "fail") {
    return {
      status: "failed",
      error: await describeTaskFailure(data.failCode, data.failMsg, data.creditsConsumed, durationSeconds),
    };
  }

  if (state === "pending" || state === "queued") {
    return { status: "pending" };
  }

  return { status: "processing" };
}
