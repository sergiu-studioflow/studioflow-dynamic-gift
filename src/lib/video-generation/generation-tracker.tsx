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

  // Poll for active generations
  useEffect(() => {
    const activeGens = generations.filter(
      (g) => g.status === "pipeline" || g.status === "processing"
    );

    for (const gen of activeGens) {
      if (pollIntervalsRef.current.has(gen.id)) continue;

      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/video-generation/generate/${gen.id}`);
          const data = await res.json();

          if (data.status === "completed" && (data.videoPreviewUrl || data.videoUrl)) {
            setGenerations((prev) =>
              prev.map((g) =>
                g.id === gen.id
                  ? {
                      ...g,
                      status: "completed" as const,
                      videoUrl: data.videoUrl,
                      videoPreviewUrl: data.videoPreviewUrl || data.videoUrl,
                    }
                  : g
              )
            );
            const iv = pollIntervalsRef.current.get(gen.id);
            if (iv) { clearInterval(iv); pollIntervalsRef.current.delete(gen.id); }
          } else if (data.status === "error") {
            setGenerations((prev) =>
              prev.map((g) =>
                g.id === gen.id
                  ? { ...g, status: "error" as const, errorMessage: data.errorMessage }
                  : g
              )
            );
            const iv = pollIntervalsRef.current.get(gen.id);
            if (iv) { clearInterval(iv); pollIntervalsRef.current.delete(gen.id); }
          }
        } catch {
          // transient
        }
      }, 4000);

      pollIntervalsRef.current.set(gen.id, interval);
    }

    // Cleanup intervals for generations no longer active
    return () => {
      for (const [id, interval] of pollIntervalsRef.current) {
        const gen = generations.find((g) => g.id === id);
        if (!gen || gen.status === "completed" || gen.status === "error") {
          clearInterval(interval);
          pollIntervalsRef.current.delete(id);
        }
      }
    };
  }, [generations]);

  return (
    <GenerationTrackerContext.Provider value={{ generations, trackGeneration, dismissGeneration }}>
      {children}
    </GenerationTrackerContext.Provider>
  );
}
