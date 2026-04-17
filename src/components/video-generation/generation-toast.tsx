"use client";

import { useGenerationTracker, type TrackedGeneration } from "@/lib/video-generation/generation-tracker";
import { Video, CheckCircle2, AlertCircle, Loader2, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";

function GenerationItem({
  gen,
  onDismiss,
  onNavigate,
}: {
  gen: TrackedGeneration;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const label = gen.arollStyle
    ? `A-Roll · ${gen.arollStyle.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())}`
    : gen.videoType === "broll"
      ? "B-Roll"
      : "UGC";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm transition-all",
        gen.status === "completed"
          ? "border-green-500/30 bg-green-500/10"
          : gen.status === "error"
            ? "border-red-500/30 bg-red-500/10"
            : "border-primary/30 bg-card/95"
      )}
    >
      {/* Icon */}
      <div className="shrink-0">
        {gen.status === "completed" ? (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        ) : gen.status === "error" ? (
          <AlertCircle className="h-5 w-5 text-red-500" />
        ) : (
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground truncate">
          {gen.productName || label}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">
          {gen.status === "completed"
            ? "Video ready"
            : gen.status === "error"
              ? gen.errorMessage || "Generation failed"
              : gen.status === "pipeline"
                ? "Building prompt..."
                : "Generating video..."}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {gen.status === "completed" && (
          <button
            onClick={onNavigate}
            className="flex items-center gap-1 rounded-md bg-green-500/20 px-2.5 py-1.5 text-[10px] font-semibold text-green-500 hover:bg-green-500/30 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            View
          </button>
        )}
        {(gen.status === "completed" || gen.status === "error") && (
          <button
            onClick={onDismiss}
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

export function GenerationToast() {
  const { generations, dismissGeneration } = useGenerationTracker();
  const pathname = usePathname();
  const router = useRouter();

  // Don't show on the video generation page itself — it has its own progress UI
  const isOnVideoPage = pathname === "/video-generation";

  // Only show generations that are active or recently completed/errored
  const visible = generations.filter((g) => {
    if (isOnVideoPage && (g.status === "pipeline" || g.status === "processing")) return false;
    return true;
  });

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 w-[320px]">
      {visible.map((gen) => (
        <GenerationItem
          key={gen.id}
          gen={gen}
          onDismiss={() => dismissGeneration(gen.id)}
          onNavigate={() => router.push("/video-generation")}
        />
      ))}
    </div>
  );
}
