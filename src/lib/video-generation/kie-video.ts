/**
 * Kie AI Seedance 2 Video client.
 * Separate from kie-ai.ts (which handles Nano Banana 2 image generation).
 *
 * Submit: POST /api/v1/jobs/createTask  (model: "bytedance/seedance-2")
 * Poll:   GET  /api/v1/jobs/recordInfo?taskId=...
 */

import { getApiKey as getConfiguredKey } from "@/lib/api-keys";

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";

async function getApiKey(): Promise<string> {
  const key = await getConfiguredKey("KIE_AI_API_KEY");
  if (!key) throw new Error("KIE_AI_API_KEY is not configured");
  return key;
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
  const res = await fetch(`${KIE_API_BASE}/createTask`, {
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
    throw new Error(`Kie AI video submit failed (${res.status}): ${text}`);
  }

  const json = await res.json();

  if (json.code !== 200 && json.code !== 0) {
    throw new Error(`Kie AI video submit error: ${json.msg || JSON.stringify(json)}`);
  }

  const taskId = json.data?.taskId ?? json.taskId;
  if (!taskId) {
    throw new Error(`Kie AI video submit: no taskId in response: ${JSON.stringify(json)}`);
  }

  return { requestId: taskId };
}

export async function pollKieVideoJob(requestId: string): Promise<KieVideoPollResult> {
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
    return { status: "failed", error: data.failMsg || "Video generation failed" };
  }

  if (state === "pending" || state === "queued") {
    return { status: "pending" };
  }

  return { status: "processing" };
}
