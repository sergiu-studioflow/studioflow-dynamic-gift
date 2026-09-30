/**
 * Video models offered in Video Generation. Shared by the UI and the server (no server imports).
 *
 * Credits are what Kie actually billed at 720p with audio (30 Sep 2026): Seedance 2.0 = 41/s
 * (15 s = 615, 5 s = 205, 4 s = 164), Seedance 2.5 = 63/s (5 s = 315). Resolution stays 720p on
 * both — 1080p pricing hasn't been measured.
 */

export type VideoModelId = "seedance-2" | "seedance-2-5";

export type VideoModel = {
  id: VideoModelId;
  label: string;
  detail: string;
  kieModel: string;
  creditsPerSecond: number;
  durations: number[];
};

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "seedance-2",
    label: "Standard",
    detail: "Seedance 2.0 · up to 15s",
    kieModel: "bytedance/seedance-2",
    creditsPerSecond: 41,
    durations: [5, 10, 15],
  },
  {
    id: "seedance-2-5",
    label: "Premium",
    detail: "Seedance 2.5 · up to 30s · ~50% more credits",
    kieModel: "bytedance/seedance-2-5",
    creditsPerSecond: 63,
    durations: [5, 10, 15, 20, 30],
  },
];

export const DEFAULT_VIDEO_MODEL: VideoModelId = "seedance-2";

/** Unknown or missing ids fall back to the default, so rows from before 0016 behave as they did. */
export function getVideoModel(id: string | null | undefined): VideoModel {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS[0];
}

export function estimateVideoCredits(durationSeconds: number, modelId?: string | null): number {
  return Math.ceil(durationSeconds * getVideoModel(modelId).creditsPerSecond);
}
