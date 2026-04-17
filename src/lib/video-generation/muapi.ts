const MUAPI_BASE = "https://api.muapi.ai/api/v1";

function getApiKey(): string {
  const key = (process.env.MUAPI_API_KEY || "").trim();
  if (!key) throw new Error("MUAPI_API_KEY is not set");
  return key;
}

export type SeedanceJobInput = {
  prompt: string;
  imageUrls: string[];
  aspectRatio: string;
  duration: number;
};

export type SeedanceSubmitResult = {
  requestId: string;
};

export type SeedancePollResult = {
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
};

export async function submitSeedanceJob({
  prompt,
  imageUrls,
  aspectRatio,
  duration,
}: SeedanceJobInput): Promise<SeedanceSubmitResult> {
  const res = await fetch(`${MUAPI_BASE}/seedance-v2.0-i2v`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getApiKey(),
    },
    body: JSON.stringify({
      prompt,
      images_list: imageUrls,
      aspect_ratio: aspectRatio,
      duration,
      quality: "high",
      remove_watermark: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Muapi submit failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const requestId = data.request_id || data.id || data.requestId;
  if (!requestId) {
    throw new Error(`Muapi submit returned no request_id: ${JSON.stringify(data)}`);
  }

  return { requestId };
}

export async function pollSeedanceJob(requestId: string): Promise<SeedancePollResult> {
  const res = await fetch(`${MUAPI_BASE}/predictions/${requestId}/result`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getApiKey(),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Muapi poll failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  // Normalize status from Muapi response
  const rawStatus = (data.status || "").toLowerCase();

  if (rawStatus === "succeeded" || rawStatus === "success" || rawStatus === "completed") {
    // Muapi returns outputs as an array: outputs: ["https://...mp4"]
    // Note: failed generations may return status "completed" with outputs: [""] and a non-empty error
    const rawUrl = data.outputs?.[0] || data.output?.video || data.output?.video_url || data.output?.[0] || data.video_url;
    const videoUrl = typeof rawUrl === "string" && rawUrl.length > 0 ? rawUrl : undefined;

    // If "completed" but no video URL and has an error, treat as failed
    if (!videoUrl && data.error) {
      return { status: "failed", error: data.error };
    }

    return { status: "completed", videoUrl };
  }

  if (rawStatus === "failed" || rawStatus === "error" || rawStatus === "cancelled") {
    return {
      status: "failed",
      error: data.error || data.message || "Video generation failed",
    };
  }

  return { status: "processing" };
}
