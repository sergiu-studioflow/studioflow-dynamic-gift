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
  Shuffle,
  Dice5,
  LayoutGrid,
  Pencil,
  RectangleHorizontal,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReferenceUpload } from "./reference-upload";
import { StepProgress, type Step } from "./step-progress";
import { InspoGalleryDialog } from "./inspo-gallery-dialog";
import { WinnersGalleryDialog } from "./winners-gallery-dialog";

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
};

type UnifiedGeneratorProps = {
  products: Product[];
  onGalleryRefresh: () => void;
  onEditAd?: (generationId: string) => void;
};

type ReferenceMode = "upload" | "auto" | "winners";

type AutoReference = {
  id: string;
  name: string;
  imageUrl: string; // R2 URL (for backend)
  previewUrl: string; // presigned URL (for display)
};

type PipelineState =
  | { phase: "idle" }
  | { phase: "pipeline"; currentStep: number }
  | { phase: "generating"; generationId: string }
  | { phase: "completed"; generationId: string; imageUrl: string }
  | { phase: "error"; message: string; failedStep?: number };

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

export function UnifiedGenerator({ products, onGalleryRefresh, onEditAd }: UnifiedGeneratorProps) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("auto");
  const [uploadedRefUrl, setUploadedRefUrl] = useState<string | null>(null);
  const [autoRef, setAutoRef] = useState<AutoReference | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [adCopy, setAdCopy] = useState("");
  const [aspectRatio, setAspectRatio] = useState("auto");
  const [inspoOpen, setInspoOpen] = useState(false);
  const [winnersOpen, setWinnersOpen] = useState(false);
  const [winnerRef, setWinnerRef] = useState<AutoReference | null>(null);
  const [winnerLoading, setWinnerLoading] = useState(false);
  const [savingToWinners, setSavingToWinners] = useState(false);
  const [savedToWinners, setSavedToWinners] = useState(false);
  const [state, setState] = useState<PipelineState>({ phase: "idle" });
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // The reference URL to send to the backend
  const activeReferenceUrl =
    referenceMode === "upload"
      ? uploadedRefUrl
      : referenceMode === "winners"
        ? winnerRef?.imageUrl || null
        : autoRef?.imageUrl || null;

  const canGenerate =
    selectedProductId && activeReferenceUrl && (state.phase === "idle" || state.phase === "completed");

  useEffect(() => {
    return () => stepTimersRef.current.forEach(clearTimeout);
  }, []);

  // Fetch a random reference from the library
  const fetchRandomRef = useCallback(async () => {
    setAutoLoading(true);
    try {
      const res = await fetch("/api/reference-library/random");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Failed to fetch random ref:", data.error);
        setAutoRef(null);
        return;
      }
      const data = await res.json();
      setAutoRef({
        id: data.id,
        name: data.name,
        imageUrl: data.imageUrl,
        previewUrl: data.previewUrl,
      });
    } catch {
      setAutoRef(null);
    } finally {
      setAutoLoading(false);
    }
  }, []);

  // Fetch a random winner from the winners library
  const fetchRandomWinner = useCallback(async () => {
    setWinnerLoading(true);
    try {
      const res = await fetch("/api/winners/random");
      if (!res.ok) { setWinnerRef(null); return; }
      const data = await res.json();
      setWinnerRef({ id: data.id, name: data.name, imageUrl: data.imageUrl, previewUrl: data.previewUrl });
    } catch { setWinnerRef(null); }
    finally { setWinnerLoading(false); }
  }, []);

  // Auto-fetch when switching modes
  useEffect(() => {
    if (referenceMode === "auto" && !autoRef) fetchRandomRef();
    if (referenceMode === "winners" && !winnerRef) fetchRandomWinner();
  }, [referenceMode, autoRef, winnerRef, fetchRandomRef, fetchRandomWinner]);

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
        // Transient
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [state, onGalleryRefresh]);

  const handleGenerate = useCallback(async () => {
    if (!selectedProductId || !activeReferenceUrl) return;

    setState({ phase: "pipeline", currentStep: 0 });
    setSavedToWinners(false);

    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = STEP_TIMINGS.slice(1).map((s) =>
      setTimeout(() => {
        setState((prev) =>
          prev.phase === "pipeline"
            ? { phase: "pipeline", currentStep: STEP_TIMINGS.indexOf(s) }
            : prev
        );
      }, s.delay)
    );

    try {
      const res = await fetch("/api/static-ads/generate/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProductId,
          referenceImageUrl: activeReferenceUrl,
          adCopy: adCopy.trim() || undefined,
          aspectRatio,
        }),
      });

      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        setState({
          phase: "error",
          message:
            res.status === 504
              ? "Request timed out — try with a smaller image."
              : `Server error (${res.status})`,
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

      setState({ phase: "generating", generationId: data.generationId as string });
    } catch (err) {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [selectedProductId, activeReferenceUrl, adCopy, aspectRatio]);

  const resetState = () => {
    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = [];
    setState({ phase: "idle" });
  };

  const regenerate = () => {
    resetState();
    // If auto mode, shuffle to a new reference
    if (referenceMode === "auto") fetchRandomRef();
    setTimeout(() => handleGenerate(), 100);
  };

  const handleSaveToWinners = useCallback(async () => {
    if (state.phase !== "completed") return;
    setSavingToWinners(true);
    try {
      const res = await fetch("/api/winners/save-from-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: state.generationId }),
      });
      if (res.ok) setSavedToWinners(true);
    } catch { /* ignore */ }
    finally { setSavingToWinners(false); }
  }, [state]);

  const isProcessing = state.phase === "pipeline" || state.phase === "generating";

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

        {/* 2. Reference Ad — Upload or Auto */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              2. Reference Ad
            </h3>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 mb-3">
            {([
              { mode: "auto" as const, icon: Dice5, label: "Auto" },
              { mode: "upload" as const, icon: UploadIcon, label: "Upload" },
              { mode: "winners" as const, icon: Trophy, label: "Winners" },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setReferenceMode(mode)}
                disabled={isProcessing}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  referenceMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Auto mode */}
          {referenceMode === "auto" && (
            <div>
              {autoLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30" />
                </div>
              ) : autoRef ? (
                <div className="relative rounded-xl border border-border bg-card overflow-hidden group">
                  <img
                    src={autoRef.previewUrl}
                    alt={autoRef.name}
                    className="w-full max-h-[200px] object-contain bg-muted/30"
                  />
                  <div className="px-3 py-2 border-t border-border bg-card flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">
                      {autoRef.name}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={fetchRandomRef}
                        disabled={isProcessing}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                      >
                        <Shuffle className="h-3 w-3" />
                        Shuffle
                      </button>
                      <button
                        onClick={() => setInspoOpen(true)}
                        disabled={isProcessing}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                      >
                        <LayoutGrid className="h-3 w-3" />
                        Browse
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground/40">
                  <ImageIcon className="h-8 w-8" />
                  <p className="text-xs">No references in library</p>
                  <p className="text-[10px]">Add some in Settings</p>
                </div>
              )}
            </div>
          )}

          {/* Upload mode */}
          {referenceMode === "upload" && (
            <ReferenceUpload
              onUploadComplete={setUploadedRefUrl}
              onRemove={() => setUploadedRefUrl(null)}
              uploadedUrl={uploadedRefUrl}
              disabled={isProcessing}
            />
          )}

          {/* Winners mode */}
          {referenceMode === "winners" && (
            <div>
              {winnerLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30" />
                </div>
              ) : winnerRef ? (
                <div className="relative rounded-xl border border-border bg-card overflow-hidden group">
                  <img
                    src={winnerRef.previewUrl}
                    alt={winnerRef.name}
                    className="w-full max-h-[200px] object-contain bg-muted/30"
                  />
                  <div className="px-3 py-2 border-t border-border bg-card flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">
                      {winnerRef.name}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={fetchRandomWinner}
                        disabled={isProcessing}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                      >
                        <Shuffle className="h-3 w-3" />
                        Shuffle
                      </button>
                      <button
                        onClick={() => setWinnersOpen(true)}
                        disabled={isProcessing}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                      >
                        <LayoutGrid className="h-3 w-3" />
                        Browse
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground/40">
                  <Trophy className="h-8 w-8" />
                  <p className="text-xs">No winners saved yet</p>
                  <p className="text-[10px]">Save your best ads from the Gallery</p>
                </div>
              )}
            </div>
          )}
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

        {/* 4. Format */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <RectangleHorizontal className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              4. Format
            </h3>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { value: "auto", label: "Auto" },
              { value: "1:1", label: "1:1" },
              { value: "4:5", label: "4:5" },
              { value: "9:16", label: "9:16" },
              { value: "16:9", label: "16:9" },
            ].map((fmt) => (
              <button
                key={fmt.value}
                onClick={() => setAspectRatio(fmt.value)}
                disabled={isProcessing}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border-2 px-3 py-2 text-xs font-medium transition-all",
                  aspectRatio === fmt.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                {fmt.value !== "auto" && (
                  <div
                    className={cn(
                      "border border-current rounded-sm",
                      fmt.value === "1:1" && "w-3.5 h-3.5",
                      fmt.value === "4:5" && "w-3 h-[15px]",
                      fmt.value === "9:16" && "w-2.5 h-[18px]",
                      fmt.value === "16:9" && "w-[18px] h-2.5"
                    )}
                  />
                )}
                {fmt.label}
              </button>
            ))}
          </div>
        </section>

        {/* 5. Summary + Generate */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              5. Generate
            </h3>
          </div>

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
                {referenceMode === "auto"
                  ? autoRef
                    ? `Auto: ${autoRef.name}`
                    : "No reference selected"
                  : referenceMode === "winners"
                    ? winnerRef
                      ? `Winner: ${winnerRef.name}`
                      : "No winner selected"
                    : uploadedRefUrl
                      ? "Custom reference uploaded"
                      : "No reference uploaded"}
                {` · ${aspectRatio}`}
                {adCopy.trim() ? " · Custom copy" : " · AI-generated copy"}
              </p>
            </div>
          </div>

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
                Generate Ad
              </>
            )}
          </button>

          {state.phase === "error" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-red-500">{state.message}</p>
                <button onClick={resetState} className="mt-1 text-[11px] text-red-400 hover:underline">
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
          {state.phase === "completed" && state.imageUrl ? (
            <div className="relative w-full">
              <img src={state.imageUrl} alt="Generated ad" className="w-full" />
              <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/60 to-transparent z-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                    <p className="text-xs text-white font-medium">
                      {selectedProduct?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveToWinners}
                      disabled={savingToWinners || savedToWinners}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md backdrop-blur-sm px-3 py-1.5 text-xs font-medium transition-colors",
                        savedToWinners
                          ? "bg-primary/30 text-primary cursor-default"
                          : "bg-white/20 text-white hover:bg-white/30"
                      )}
                    >
                      {savingToWinners ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : savedToWinners ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Trophy className="h-3 w-3" />
                      )}
                      {savedToWinners ? "Winner!" : "Winner"}
                    </button>
                    {onEditAd && (
                      <button
                        onClick={() => onEditAd(state.generationId)}
                        className="flex items-center gap-1.5 rounded-md bg-white/20 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30 transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit Text
                      </button>
                    )}
                    <button
                      onClick={handleGenerate}
                      className="rounded-md bg-white/20 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30 transition-colors"
                    >
                      Re-Generate
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : state.phase === "pipeline" || state.phase === "generating" ? (
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
            <div className="flex flex-col items-center gap-6 p-10 w-full max-w-sm">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 w-full">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-4">
                  Pipeline Error
                </p>
                <StepProgress steps={currentSteps} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-10 text-muted-foreground/40">
              <ImageIcon className="h-12 w-12" />
              <p className="text-sm">Your ad will appear here</p>
              <p className="text-[11px] text-muted-foreground/30 text-center max-w-xs">
                Select a product, choose a reference, and click Generate
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Inspo Gallery Modal */}
      <InspoGalleryDialog
        open={inspoOpen}
        onClose={() => setInspoOpen(false)}
        onSelect={(ref) => {
          setAutoRef({
            id: ref.id,
            name: ref.name,
            imageUrl: ref.imageUrl,
            previewUrl: ref.previewUrl,
          });
          setReferenceMode("auto");
        }}
      />

      {/* Winners Gallery Modal */}
      <WinnersGalleryDialog
        open={winnersOpen}
        onClose={() => setWinnersOpen(false)}
        onSelect={(ref) => {
          setWinnerRef({
            id: ref.id,
            name: ref.name,
            imageUrl: ref.imageUrl,
            previewUrl: ref.previewUrl,
          });
          setReferenceMode("winners");
        }}
      />
    </div>
  );
}
