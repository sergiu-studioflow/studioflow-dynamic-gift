/**
 * Kie AI Nano Banana 2 API client for static ad generation.
 *
 * Create task: POST /api/v1/jobs/createTask
 * Poll task:   GET  /api/v1/jobs/recordInfo?taskId=...
 */

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";

function getApiKey(): string {
  const key = process.env.KIE_AI_API_KEY;
  if (!key) throw new Error("KIE_AI_API_KEY environment variable is not set");
  return key;
}

// -- Types --

export type KieJobParams = {
  prompt: string;
  imageUrls: string[]; // Public URLs (R2) — up to 14
  aspectRatio?: string; // "1:1" | "2:3" | "3:2" | "9:16" | "16:9" etc. Default: "1:1"
  resolution?: string;  // "1K" | "2K" | "4K". Default: "1K"
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

  const requestBody = {
    model: "nano-banana-2",
    input: {
      prompt: params.prompt,
      image_input: params.imageUrls,
      aspect_ratio: ratio,
      resolution: params.resolution || "1K",
      output_format: params.outputFormat || "png",
    },
  };

  const res = await fetch(`${KIE_API_BASE}/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
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

// -- Poll --

export async function pollKieJob(taskId: string): Promise<KiePollResult> {
  const res = await fetch(`${KIE_API_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
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
