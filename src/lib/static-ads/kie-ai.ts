/**
 * Kie AI Nano Banana 2 API client for static ad generation.
 *
 * Create task: POST /api/v1/jobs/createTask
 * Poll task:   GET  /api/v1/jobs/recordInfo?taskId=...
 */

import { getApiKey as getConfiguredKey } from "@/lib/api-keys";

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";

async function getApiKey(): Promise<string> {
  const key = await getConfiguredKey("KIE_AI_API_KEY");
  if (!key) throw new Error("KIE_AI_API_KEY is not configured");
  return key;
}

// -- Types --

export type KieJobParams = {
  prompt: string;
  imageUrls: string[]; // Public URLs (R2) — up to 14
  aspectRatio?: string; // "1:1" | "2:3" | "3:2" | "9:16" | "16:9" etc. Default: "1:1"
  resolution?: string;  // "1K" | "2K" | "4K". Default: "2K"
  outputFormat?: string; // "png" | "jpg". Default: "png"
};

export type KieSubmitResult = {
  taskId: string;
};

export type KiePollResult = {
  state: "pending" | "processing" | "success" | "failed";
  resultUrls: string[];
  errorMessage?: string;
  costTime?: number;
};

// -- Submit --

export async function submitKieJob(params: KieJobParams): Promise<KieSubmitResult> {
  const ratio = params.aspectRatio || "auto";
  const apiKey = await getApiKey();

  const requestBody = {
    model: "nano-banana-2",
    input: {
      prompt: params.prompt,
      image_input: params.imageUrls,
      aspect_ratio: ratio,
      resolution: params.resolution || "2K",
      output_format: params.outputFormat || "png",
    },
  };

  const res = await fetch(`${KIE_API_BASE}/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kie AI createTask failed (${res.status}): ${text}`);
  }

  const json = await res.json();

  // Response: { code: 200, msg: "...", data: { taskId: "..." } }
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(`Kie AI createTask error: ${json.msg || JSON.stringify(json)}`);
  }

  const taskId = json.data?.taskId ?? json.taskId;
  if (!taskId) {
    throw new Error(`Kie AI createTask: no taskId in response: ${JSON.stringify(json)}`);
  }

  return { taskId };
}

// -- GPT Image 2 (image-to-image, used for the product-consistency refinement step) --

/** Fixed prompt for the refinement step — keep composition, swap the product. */
export const REFINE_PROMPT = "Keep everything the same, swap the product to the product image attached";

/** Aspect ratios GPT Image 2 supports directly (per Kie docs). */
const GPT2_SUPPORTED_RATIOS = new Set(["1:1", "9:16", "16:9", "4:3", "3:4"]);

/**
 * Map our broader aspect-ratio set to GPT Image 2's supported subset.
 * Unsupported ratios get a best-effort approximation, else "auto" (which
 * preserves the input image's framing but caps resolution to 1K per Kie docs).
 */
export function mapAspectForGpt2(ratio: string | null | undefined): string {
  if (!ratio) return "auto";
  if (GPT2_SUPPORTED_RATIOS.has(ratio)) return ratio;
  switch (ratio) {
    case "4:5":
    case "2:3":
      return "3:4";
    case "5:4":
    case "3:2":
      return "4:3";
    case "21:9":
      return "16:9";
    case "1:4":
      return "9:16";
    default:
      return "auto";
  }
}

export type GptImage2Params = {
  prompt: string;
  inputUrls: string[]; // Public/presigned URLs. Up to 16.
  aspectRatio?: string; // "auto" | "1:1" | "9:16" | "16:9" | "4:3" | "3:4". Default: "auto"
  resolution?: string;  // "1K" | "2K" | "4K". Note: "auto" aspect caps to 1K, "1:1" caps to 2K.
};

/**
 * Submit a GPT Image 2 image-to-image job. Shares the polling endpoint with
 * nano-banana-2 (`recordInfo`), so `pollKieJob` works for results here too.
 */
export async function submitGptImage2Job(params: GptImage2Params): Promise<KieSubmitResult> {
  const apiKey = await getApiKey();
  const aspectRatio = params.aspectRatio || "auto";

  // Per the Kie docs: "auto" aspect is limited to 1K; "1:1" cannot use 4K.
  let resolution = params.resolution || (aspectRatio === "auto" ? "1K" : "2K");
  if (aspectRatio === "auto" && resolution !== "1K") resolution = "1K";
  if (aspectRatio === "1:1" && resolution === "4K") resolution = "2K";

  const requestBody = {
    model: "gpt-image-2-image-to-image",
    input: {
      prompt: params.prompt,
      input_urls: params.inputUrls,
      aspect_ratio: aspectRatio,
      resolution,
    },
  };

  const res = await fetch(`${KIE_API_BASE}/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kie GPT Image 2 createTask failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json.code !== 200 && json.code !== 0) {
    throw new Error(`Kie GPT Image 2 createTask error: ${json.msg || JSON.stringify(json)}`);
  }

  const taskId = json.data?.taskId ?? json.taskId;
  if (!taskId) {
    throw new Error(`Kie GPT Image 2 createTask: no taskId in response: ${JSON.stringify(json)}`);
  }

  return { taskId };
}

// -- Poll --

export async function pollKieJob(taskId: string): Promise<KiePollResult> {
  const apiKey = await getApiKey();
  const res = await fetch(`${KIE_API_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kie AI recordInfo failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const data = json.data || {};

  // Parse state
  const state = data.state as string | undefined;

  // Parse result URLs from resultJson (stringified JSON)
  let resultUrls: string[] = [];
  if (data.resultJson) {
    try {
      const parsed = typeof data.resultJson === "string" ? JSON.parse(data.resultJson) : data.resultJson;
      resultUrls = parsed.resultUrls || [];
    } catch {
      // resultJson might not be valid JSON
    }
  }

  // Map Kie AI states to our simplified states
  const stateMap: Record<string, KiePollResult["state"]> = {
    success: "success",
    failed: "failed",
    fail: "failed",
    pending: "pending",
    processing: "processing",
    running: "processing",
    queued: "pending",
  };

  return {
    state: stateMap[state || "pending"] || "processing",
    resultUrls,
    errorMessage: data.failMsg || undefined,
    costTime: data.costTime || undefined,
  };
}
