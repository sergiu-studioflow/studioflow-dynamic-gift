"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ImageIcon,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Package,
  Upload as UploadIcon,
  FileText,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReferenceUpload } from "./reference-upload";
import { StepProgress, type Step } from "./step-progress";

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
};

type CustomGeneratorProps = {
  products: Product[];
  onGalleryRefresh: () => void;
};

type PipelineState =
  | { phase: "idle" }
  | { phase: "pipeline"; currentStep: number }
  | { phase: "generating"; generationId: string }
  | { phase: "completed"; generationId: string; imageUrl: string }
  | { phase: "error"; message: string; failedStep?: number };

// Timer-based step transitions (approximate Claude call durations)
const STEP_TIMINGS = [
  { delay: 0, label: "Analyzing reference ad..." },
  { delay: 12000, label: "Crafting generation prompt..." },
  { delay: 28000, label: "Submitting to image engine..." },
];

function buildSteps(currentStep: number): Step[] {
  return [
    { label: "Analyzing reference ad...", status: currentStep === 0 ? "active" : currentStep > 0 ? "complete" : "pending" },
    { label: "Crafting generation prompt...", status: currentStep === 1 ? "active" : currentStep > 1 ? "complete" : "pending" },
    { label: "Submitting to image engine...", status: currentStep === 2 ? "active" : currentStep > 2 ? "complete" : "pending" },
    { label: "Generating your ad...", status: currentStep >= 3 ? "active" : "pending" },
  ];
}

export function CustomGenerator({ products, onGalleryRefresh }: CustomGeneratorProps) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [adCopy, setAdCopy] = useState("");
  const [state, setState] = useState<PipelineState>({ phase: "idle" });
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const canGenerate = selectedProductId && referenceImageUrl && state.phase === "idle";

  // Clean up timers on unmount
  useEffect(() => {
    return () => stepTimersRef.current.forEach(clearTimeout);
  }, []);

  // Poll for Kie generation completion
  useEffect(() => {
    if (state.phase !== "generating") return;
    const { generationId } = state;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/static-ads/generate/${generationId}`);
        const data = await res.json();

        if (data.status === "completed" && data.imageUrl) {
          setState({ phase: "completed", generationId, imageUrl: data.imageUrl });
          onGalleryRefresh();
          setTimeout(() => {
            fetch(`/api/static-ads/generate/${generationId}`).catch(() => {});
          }, 2000);
        } else if (data.status === "error") {
          setState({
            phase: "error",
            message: data.errorMessage || "Image generation failed",
          });
        }
      } catch {
        // Transient error, keep polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [state, onGalleryRefresh]);

  const handleGenerate = useCallback(async () => {
    if (!selectedProductId || !referenceImageUrl) return;

    // Start pipeline with timer-based step animation
    setState({ phase: "pipeline", currentStep: 0 });

    // Schedule step transitions
    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = STEP_TIMINGS.slice(1).map((s) =>
      setTimeout(() => {
        setState((prev) =>
          prev.phase === "pipeline" ? { phase: "pipeline", currentStep: STEP_TIMINGS.indexOf(s) } : prev
        );
      }, s.delay)
    );

    try {
      const res = await fetch("/api/static-ads/generate/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProductId,
          referenceImageUrl,
          adCopy: adCopy.trim() || undefined,
        }),
      });

      // Clear step timers
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];

      // Handle non-JSON responses (e.g. Vercel 504 timeout HTML page)
      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        const text = await res.text().catch(() => "");
        setState({
          phase: "error",
          message: res.status === 504
            ? "Request timed out — the pipeline took too long. Try with a smaller image."
            : `Server error (${res.status}): ${text.slice(0, 100)}`,
        });
        return;
      }

      if (!res.ok || data.error) {
        setState({
          phase: "error",
          message: (data.error as string) || "Pipeline failed",
          failedStep: data.failedStep as number | undefined,
        });
        return;
      }

      // Pipeline complete → switch to Kie polling
      setState({ phase: "generating", generationId: data.generationId as string });
    } catch (err) {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [selectedProductId, referenceImageUrl, adCopy]);

  const resetState = () => {
    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = [];
    setState({ phase: "idle" });
  };

  const regenerate = () => {
    resetState();
    setTimeout(() => handleGenerate(), 0);
  };

  const isProcessing = state.phase === "pipeline" || state.phase === "generating";

  // Build step progress display
  const currentSteps: Step[] =
    state.phase === "pipeline"
      ? buildSteps(state.currentStep)
      : state.phase === "generating"
        ? buildSteps(3)
        : state.phase === "error" && state.failedStep
          ? buildSteps(state.failedStep - 1).map((s, i) =>
              i === (state as { failedStep: number }).failedStep! - 1
                ? { ...s, status: "error" as const, detail: (state as { message: string }).message }
                : s
            )
          : [];

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6">
      {/* LEFT: stacked modules */}
      <div className="flex flex-col gap-4 lg:w-[480px] lg:shrink-0">
        {/* 1. Product picker */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              1. Choose Product
            </h3>
          </div>
          <div className="grid grid-cols-4 gap-2 max-h-[240px] overflow-y-auto pr-1">
            {products.map((p) => {
              const isSelected = selectedProductId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProductId(p.id)}
                  disabled={isProcessing}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40",
                    isProcessing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[9px] leading-tight font-medium line-clamp-2",
                      isSelected ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {p.name}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Reference image upload */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <UploadIcon className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              2. Upload Reference Ad
            </h3>
          </div>
          <ReferenceUpload
            onUploadComplete={setReferenceImageUrl}
            onRemove={() => setReferenceImageUrl(null)}
            uploadedUrl={referenceImageUrl}
            disabled={isProcessing}
          />
        </section>

        {/* 3. Ad Copy */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              3. Ad Copy{" "}
              <span className="text-muted-foreground/50 normal-case font-normal">(optional)</span>
            </h3>
          </div>
          <textarea
            value={adCopy}
            onChange={(e) => setAdCopy(e.target.value)}
            disabled={isProcessing}
            placeholder="Enter the text/copy you want on the ad... Leave empty to let AI generate copy."
            rows={3}
            className={cn(
              "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50",
              isProcessing && "opacity-50 cursor-not-allowed"
            )}
          />
        </section>

        {/* 4. Summary + Generate */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              4. Generate
            </h3>
          </div>

          {/* Summary */}
          <div className="flex items-center gap-3 mb-4 rounded-lg bg-muted/30 p-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
              {selectedProduct?.imageUrl ? (
                <img src={selectedProduct.imageUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Package className="h-4 w-4 text-muted-foreground/30" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {selectedProduct?.name || "No product selected"}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {referenceImageUrl ? "Reference uploaded" : "No reference image"}
                {adCopy.trim() ? " · Custom copy" : " · AI-generated copy"}
              </p>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200",
              canGenerate
                ? "bg-primary text-primary-foreground hover:brightness-110 shadow-[0_0_20px_rgba(178,255,0,0.2)]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Custom Ad
              </>
            )}
          </button>

          {/* Error feedback */}
          {state.phase === "error" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-red-500">{state.message}</p>
                <button
                  onClick={resetState}
                  className="mt-1 text-[11px] text-red-400 hover:underline"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* RIGHT: result preview / step progress */}
      <div className="flex-1 min-w-0">
        <div className="sticky top-6 rounded-xl border border-border bg-card overflow-hidden min-h-[400px] flex items-center justify-center">
          {/* Completed — show image */}
          {state.phase === "completed" && state.imageUrl ? (
            <div className="relative w-full">
              <img src={state.imageUrl} alt="Generated ad" className="w-full" />
              <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/60 to-transparent z-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    <p className="text-xs text-white font-medium">
                      {selectedProduct?.name} · Custom
                    </p>
                  </div>
                  <button
                    onClick={regenerate}
                    className="rounded-md bg-white/20 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30 transition-colors"
                  >
                    Generate another
                  </button>
                </div>
              </div>
            </div>
          ) : state.phase === "pipeline" || state.phase === "generating" ? (
            /* Pipeline or Kie generation in progress */
            <div className="flex flex-col items-center gap-6 p-10 w-full max-w-sm">
              <div className="rounded-2xl border border-border bg-muted/20 p-6 w-full">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                  Pipeline Progress
                </p>
                <StepProgress steps={currentSteps} />
              </div>
              <p className="text-[11px] text-muted-foreground/60 text-center">
                {state.phase === "pipeline"
                  ? "AI analysis and prompt generation — typically 30–50 seconds"
                  : "Image generation — typically 30–60 seconds"}
              </p>
            </div>
          ) : state.phase === "error" && state.failedStep ? (
            /* Error with step context */
            <div className="flex flex-col items-center gap-6 p-10 w-full max-w-sm">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 w-full">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-4">
                  Pipeline Error
                </p>
                <StepProgress steps={currentSteps} />
              </div>
            </div>
          ) : (
            /* Idle placeholder */
            <div className="flex flex-col items-center gap-3 p-10 text-muted-foreground/40">
              <ImageIcon className="h-12 w-12" />
              <p className="text-sm">Your custom ad will appear here</p>
              <p className="text-[11px] text-muted-foreground/30 text-center max-w-xs">
                Select a product, upload a reference ad, and click Generate
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
