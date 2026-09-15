"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

export type TrackedGeneration = {
  id: string;
  productName: string | null;
  videoType: string;
  arollStyle?: string;
  status: "pipeline" | "processing" | "completed" | "error";
  videoUrl?: string;
  videoPreviewUrl?: string;
  errorMessage?: string;
  currentStep?: number;
};

type GenerationTrackerContextType = {
  generations: TrackedGeneration[];
  trackGeneration: (gen: TrackedGeneration) => void;
  dismissGeneration: (id: string) => void;
};

const GenerationTrackerContext = createContext<GenerationTrackerContextType>({
  generations: [],
  trackGeneration: () => {},
  dismissGeneration: () => {},
});

export function useGenerationTracker() {
  return useContext(GenerationTrackerContext);
}

const POLL_INTERVAL_MS = 4000;

export function GenerationTrackerProvider({ children }: { children: React.ReactNode }) {
  const [generations, setGenerations] = useState<TrackedGeneration[]>([]);
  const pollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const trackGeneration = useCallback((gen: TrackedGeneration) => {
    setGenerations((prev) => {
      const exists = prev.find((g) => g.id === gen.id);
      if (exists) return prev.map((g) => (g.id === gen.id ? gen : g));
      return [...prev, gen];
    });
  }, []);

  // On mount, sweep for any stuck processing generations from previous sessions
  useEffect(() => {
    fetch("/api/video-generation/sweep").catch(() => {});
  }, []);

  const dismissGeneration = useCallback((id: string) => {
    setGenerations((prev) => prev.filter((g) => g.id !== id));
    const interval = pollIntervalsRef.current.get(id);
    if (interval) {
      clearInterval(interval);
      pollIntervalsRef.current.delete(id);
    }
  }, []);

  // Poll every active generation. The server is the source of truth: `pending` means the
  // prompt pipeline is still running, `processing` means the video is rendering, and
  // `completed` / `error` (or a 404) are terminal — polling stops there. A pipeline that
  // died is failed server-side by its abandon clock, so no poll runs forever.
  useEffect(() => {
    const intervals = pollIntervalsRef.current;
    const activeIds = new Set(
      generations.filter((g) => g.status === "pipeline" || g.status === "processing").map((g) => g.id)
    );

    const finish = (id: string, patch: Partial<TrackedGeneration>) => {
      setGenerations((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
      const iv = intervals.get(id);
      if (iv) {
        clearInterval(iv);
        intervals.delete(id);
      }
    };

    for (const id of activeIds) {
      if (intervals.has(id)) continue;

      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/video-generation/generate/${id}`);
          if (res.status === 404) {
            finish(id, { status: "error", errorMessage: "This generation no longer exists" });
            return;
          }
          if (!res.ok) return; // transient — keep polling

          const data = await res.json();
          if (data.status === "completed") {
            finish(id, {
              status: "completed",
              videoUrl: data.videoUrl,
              videoPreviewUrl: data.videoPreviewUrl || data.videoUrl,
            });
          } else if (data.status === "error") {
            finish(id, { status: "error", errorMessage: data.errorMessage || "Video generation failed" });
          } else {
            const next: TrackedGeneration["status"] = data.status === "processing" ? "processing" : "pipeline";
            setGenerations((prev) =>
              prev.map((g) => {
                if (g.id !== id) return g;
                const step = data.currentStep ?? g.currentStep;
                return g.status !== next || g.currentStep !== step ? { ...g, status: next, currentStep: step } : g;
              })
            );
          }
        } catch {
          // transient
        }
      }, POLL_INTERVAL_MS);

      intervals.set(id, interval);
    }

    // Stop pollers for generations that finished or were dismissed.
    for (const [id, interval] of intervals) {
      if (!activeIds.has(id)) {
        clearInterval(interval);
        intervals.delete(id);
      }
    }
  }, [generations]);

  // Clear every poller when the provider unmounts.
  useEffect(() => {
    const intervals = pollIntervalsRef.current;
    return () => {
      for (const interval of intervals.values()) clearInterval(interval);
      intervals.clear();
    };
  }, []);

  return (
    <GenerationTrackerContext.Provider value={{ generations, trackGeneration, dismissGeneration }}>
      {children}
    </GenerationTrackerContext.Provider>
  );
}
