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
  Download as DownloadIcon,
  Copy as CopyIcon,
  Gauge,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ReferenceUpload } from "./reference-upload";
import { StepProgress, type Step } from "./step-progress";
import { InspoGalleryDialog } from "./inspo-gallery-dialog";
import { WinnersGalleryDialog } from "./winners-gallery-dialog";
import { useClient } from "@/lib/client-context";

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

type VariationStatus = "pending" | "completed" | "error";

type VariationResult = {
  id: string;
  status: VariationStatus;
  imageUrl?: string;
  errorMessage?: string;
  /** Server hint for which step of the chain this id is currently in. */
  kieState?: "waiting-source" | "processing" | "pending" | string;
};

type FormatGroup = {
  aspectRatio: string;
  batchId: string;
  results: VariationResult[]; // refined ids only — intermediates are server-only
};

type PipelineState =
  | { phase: "idle" }
  | { phase: "pipeline"; currentStep: number; variationCount: number; formatCount: number }
  | {
      phase: "generating";
      formats: FormatGroup[];
    }
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
  const { clientId, clientSlug } = useClient();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("auto");
  const [uploadedRefUrl, setUploadedRefUrl] = useState<string | null>(null);
  const [autoRef, setAutoRef] = useState<AutoReference | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [adCopy, setAdCopy] = useState("");
  // Multi-format: a Set so order is preserved roughly. "auto" is mutually
  // exclusive with explicit ratios — the UI handlers below enforce this.
  const [aspectRatios, setAspectRatios] = useState<Set<string>>(() => new Set(["1:1"]));
  const [resolution, setResolution] = useState<"1K" | "2K" | "4K">("2K");
  const [variationCount, setVariationCount] = useState(1);
  const [inspoOpen, setInspoOpen] = useState(false);
  const [winnersOpen, setWinnersOpen] = useState(false);
  const [winnerRef, setWinnerRef] = useState<AutoReference | null>(null);
  const [winnerLoading, setWinnerLoading] = useState(false);
  const [savedWinnerIds, setSavedWinnerIds] = useState<Set<string>>(new Set());
  const [savingWinnerIds, setSavingWinnerIds] = useState<Set<string>>(new Set());
  const [state, setState] = useState<PipelineState>({ phase: "idle" });
  // Lightbox now identifies a tile within a specific format group.
  const [lightboxIndex, setLightboxIndex] = useState<
    { formatIndex: number; tileIndex: number } | null
  >(null);
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const toggleAspectRatio = (value: string) => {
    setAspectRatios((prev) => {
      const next = new Set(prev);
      if (value === "auto") {
        // Selecting "auto" replaces any other choices.
        return new Set(["auto"]);
      }
      next.delete("auto"); // explicit ratio drops auto
      if (next.has(value)) {
        next.delete(value);
        if (next.size === 0) next.add(value); // never empty — keep this one
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // The reference URL to send to the backend
  const activeReferenceUrl =
    referenceMode === "upload"
      ? uploadedRefUrl
      : referenceMode === "winners"
        ? winnerRef?.imageUrl || null
        : autoRef?.imageUrl || null;

  const allTilesDone =
    state.phase === "generating" &&
    state.formats.every((fg) => fg.results.every((r) => r.status !== "pending"));
  const canGenerate =
    !!selectedProductId &&
    !!activeReferenceUrl &&
    aspectRatios.size > 0 &&
    (state.phase === "idle" || state.phase === "error" || allTilesDone);

  useEffect(() => {
    return () => stepTimersRef.current.forEach(clearTimeout);
  }, []);

  // Fetch a random reference from the library. Scoped to the active client so a
  // brand draws on its own references (with the shared pool as fallback) rather
  // than a random ad from every other brand's pool.
  const fetchRandomRef = useCallback(async () => {
    setAutoLoading(true);
    try {
      const res = await fetch(`/api/reference-library/random${clientId ? `?clientId=${clientId}` : ""}`);
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
  }, [clientId]);

  // Fetch a random winner from the winners library
  const fetchRandomWinner = useCallback(async () => {
    setWinnerLoading(true);
    try {
      const res = await fetch(`/api/winners/random${clientId ? `?clientId=${clientId}` : ""}`);
      if (!res.ok) { setWinnerRef(null); return; }
      const data = await res.json();
      setWinnerRef({ id: data.id, name: data.name, imageUrl: data.imageUrl, previewUrl: data.previewUrl });
    } catch { setWinnerRef(null); }
    finally { setWinnerLoading(false); }
  }, []);

  // Drop a reference belonging to the previous brand as soon as the client changes,
  // so the auto-fetch below re-runs instead of keeping another brand's ad selected.
  useEffect(() => {
    setAutoRef(null);
    setWinnerRef(null);
  }, [clientId]);

  // Auto-fetch when switching modes
  useEffect(() => {
    if (referenceMode === "auto" && !autoRef) fetchRandomRef();
    if (referenceMode === "winners" && !winnerRef) fetchRandomWinner();
  }, [referenceMode, autoRef, winnerRef, fetchRandomRef, fetchRandomWinner]);

  // Poll every pending refined tile across every format group, in parallel.
  useEffect(() => {
    if (state.phase !== "generating") return;
    const pendingIds = state.formats.flatMap((fg) =>
      fg.results.filter((r) => r.status === "pending").map((r) => r.id)
    );
    if (pendingIds.length === 0) return;

    const interval = setInterval(async () => {
      const responses = await Promise.allSettled(
        pendingIds.map(async (id) => {
          const res = await fetch(`/api/static-ads/generate/${id}`);
          const data = await res.json();
          return { id, data };
        })
      );

      let refreshGallery = false;

      const applyUpdate = (entry: VariationResult): VariationResult => {
        if (entry.status !== "pending") return entry;
        const match = responses.find(
          (r) => r.status === "fulfilled" && r.value.id === entry.id
        );
        if (!match || match.status !== "fulfilled") return entry;
        const { data } = match.value;
        if (data.status === "completed" && data.imageUrl) {
          refreshGallery = true;
          return { ...entry, status: "completed" as const, imageUrl: data.imageUrl };
        }
        if (data.status === "error") {
          return {
            ...entry,
            status: "error" as const,
            errorMessage: data.errorMessage || "Image generation failed",
          };
        }
        // Carry the server's chain-state hint forward so the tile can pick
        // the right "Generating variation…" vs "Refining…" copy.
        return { ...entry, kieState: data.kieState };
      };

      setState((prev) => {
        if (prev.phase !== "generating") return prev;
        const nextFormats = prev.formats.map((fg) => ({
          ...fg,
          results: fg.results.map(applyUpdate),
        }));
        return { ...prev, formats: nextFormats };
      });

      if (refreshGallery) onGalleryRefresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [state, onGalleryRefresh]);

  const handleGenerate = useCallback(async () => {
    if (!selectedProductId || !activeReferenceUrl) return;
    if (aspectRatios.size === 0) return;

    const requestedCount = Math.max(1, Math.min(5, variationCount));
    const ratios = Array.from(aspectRatios);
    setState({
      phase: "pipeline",
      currentStep: 0,
      variationCount: requestedCount,
      formatCount: ratios.length,
    });
    setSavedWinnerIds(new Set());
    setSavingWinnerIds(new Set());

    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = STEP_TIMINGS.slice(1).map((s) =>
      setTimeout(() => {
        setState((prev) =>
          prev.phase === "pipeline"
            ? {
                phase: "pipeline",
                currentStep: STEP_TIMINGS.indexOf(s),
                variationCount: prev.variationCount,
                formatCount: prev.formatCount,
              }
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
          aspectRatios: ratios,
          resolution,
          clientId,
          variationCount: requestedCount,
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

      const formats = data.formats as
        | { aspectRatio: string; batchId: string; items: { refinedId: string; sourceVariationId: string }[] }[]
        | undefined;
      if (!formats || formats.length === 0) {
        setState({
          phase: "error",
          message: "Generation started but no format groups were returned",
        });
        return;
      }

      setState({
        phase: "generating",
        formats: formats.map((f) => ({
          aspectRatio: f.aspectRatio,
          batchId: f.batchId,
          results: f.items.map((it) => ({ id: it.refinedId, status: "pending" as const })),
        })),
      });
    } catch (err) {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [selectedProductId, activeReferenceUrl, adCopy, aspectRatios, resolution, clientId, variationCount]);

  const resetState = () => {
    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = [];
    setState({ phase: "idle" });
  };

  const handleSaveToWinners = useCallback(async (generationId: string) => {
    if (savedWinnerIds.has(generationId) || savingWinnerIds.has(generationId)) return;
    setSavingWinnerIds((prev) => new Set(prev).add(generationId));
    try {
      const res = await fetch("/api/winners/save-from-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId }),
      });
      if (res.ok) {
        setSavedWinnerIds((prev) => new Set(prev).add(generationId));
      }
    } catch { /* ignore */ }
    finally {
      setSavingWinnerIds((prev) => {
        const next = new Set(prev);
        next.delete(generationId);
        return next;
      });
    }
  }, [savedWinnerIds, savingWinnerIds]);

  const handleDownload = useCallback((generationId: string, imageUrl: string) => {
    const filename = `${selectedProduct?.name?.replace(/\s+/g, "-") || "ad"}-${generationId.slice(0, 8)}.png`;
    const proxyUrl = `/api/static-ads/download?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(filename)}`;
    window.open(proxyUrl, "_blank");
  }, [selectedProduct]);

  const isProcessing =
    state.phase === "pipeline" ||
    (state.phase === "generating" && !allTilesDone);

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
              clientSlug={clientSlug}
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
            ].map((fmt) => {
              const selected = aspectRatios.has(fmt.value);
              return (
                <button
                  key={fmt.value}
                  onClick={() => toggleAspectRatio(fmt.value)}
                  disabled={isProcessing}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border-2 px-3 py-2 text-xs font-medium transition-all",
                    selected
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
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            Pick one or more formats — you&apos;ll get every variation rendered in each.
          </p>
        </section>

        {/* 5. Quality */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              5. Quality
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            {([
              { value: "1K" as const, label: "1K", subtitle: "Fast" },
              { value: "2K" as const, label: "2K", subtitle: "Standard" },
              { value: "4K" as const, label: "4K", subtitle: "Print" },
            ]).map(({ value, label, subtitle }) => (
              <button
                key={value}
                onClick={() => setResolution(value)}
                disabled={isProcessing}
                className={cn(
                  "flex-1 rounded-lg border-2 py-2 text-xs font-semibold transition-all",
                  resolution === value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                <div>{label}</div>
                <div className="text-[9px] font-normal opacity-70 normal-case tracking-normal">
                  {subtitle}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            Higher resolution = sharper output but costs more per generation.
          </p>
        </section>

        {/* 6. Variations */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <CopyIcon className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              6. Variations
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setVariationCount(n)}
                disabled={isProcessing}
                className={cn(
                  "flex-1 rounded-lg border-2 py-2 text-xs font-semibold transition-all",
                  variationCount === n
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            {variationCount === 1
              ? "One ad will be generated."
              : `${variationCount} variations of the same concept will be generated in parallel.`}
          </p>
        </section>

        {/* 7. Summary + Generate */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              7. Generate
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
                {` · ${Array.from(aspectRatios).join(" + ")} · ${resolution}`}
                {variationCount > 1 ? ` · ${variationCount} variations` : ""}
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
                ? "bg-primary text-primary-foreground hover:brightness-110 shadow-[0_0_20px_rgba(234,70,72,0.25)]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (() => {
              const fCount = aspectRatios.size;
              const total = variationCount * fCount;
              if (allTilesDone) {
                return (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate again
                  </>
                );
              }
              if (variationCount === 1 && fCount === 1) {
                return (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Ad
                  </>
                );
              }
              const piece =
                fCount > 1
                  ? `${variationCount} variation${variationCount > 1 ? "s" : ""} × ${fCount} formats`
                  : `${variationCount} variations`;
              return (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate {piece} ({total} ads)
                </>
              );
            })()}
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

      {/* RIGHT: result preview / step progress / per-format final-ads grids */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {state.phase === "generating" ? (
          state.formats.map((fg, fi) => {
            const ready = fg.results.filter((r) => r.status === "completed").length;
            return (
              <div
                key={fg.batchId}
                className="rounded-xl border border-border bg-card overflow-hidden p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {fg.aspectRatio === "auto" ? "Final ads" : `${fg.aspectRatio} finals`}
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground/70">
                      product-consistent
                    </span>
                  </h3>
                  <p className="text-[11px] text-muted-foreground/70">
                    {ready}/{fg.results.length} ready
                  </p>
                </div>
                <VariationsGrid
                  results={fg.results}
                  productName={selectedProduct?.name}
                  savedWinnerIds={savedWinnerIds}
                  savingWinnerIds={savingWinnerIds}
                  onSaveWinner={handleSaveToWinners}
                  onEdit={onEditAd}
                  onDownload={handleDownload}
                  onZoom={(tileIndex) => setLightboxIndex({ formatIndex: fi, tileIndex })}
                />
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden min-h-[400px] flex items-center justify-center p-4">
            {state.phase === "pipeline" ? (
              <div className="flex flex-col items-center gap-6 p-10 w-full max-w-sm">
                <div className="rounded-2xl border border-border bg-muted/20 p-6 w-full">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                    Pipeline Progress
                    {(state.variationCount > 1 || state.formatCount > 1) && (
                      <span className="ml-2 text-primary normal-case tracking-normal">
                        · {state.variationCount} variation{state.variationCount > 1 ? "s" : ""}
                        {state.formatCount > 1 ? ` × ${state.formatCount} formats` : ""}
                      </span>
                    )}
                  </p>
                  <StepProgress steps={currentSteps} />
                </div>
                <p className="text-[11px] text-muted-foreground/60 text-center">
                  AI analysis and prompt generation — typically 30–50 seconds. Each
                  final ad then runs through a product-consistency refinement step.
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
        )}
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

      {/* Lightbox — click any tile to inspect at full size. Arrow keys cycle
         within the same format group only (each group is a distinct artifact). */}
      {state.phase === "generating" && lightboxIndex !== null && (() => {
        const fg = state.formats[lightboxIndex.formatIndex];
        if (!fg || fg.results.length === 0) return null;
        const fi = lightboxIndex.formatIndex;
        const total = fg.results.length;
        return (
          <VariationLightbox
            results={fg.results}
            index={lightboxIndex.tileIndex}
            productName={selectedProduct?.name}
            savedWinnerIds={savedWinnerIds}
            savingWinnerIds={savingWinnerIds}
            onClose={() => setLightboxIndex(null)}
            onPrev={() =>
              setLightboxIndex((prev) =>
                prev === null
                  ? null
                  : { formatIndex: fi, tileIndex: (prev.tileIndex - 1 + total) % total }
              )
            }
            onNext={() =>
              setLightboxIndex((prev) =>
                prev === null
                  ? null
                  : { formatIndex: fi, tileIndex: (prev.tileIndex + 1) % total }
              )
            }
            onSaveWinner={handleSaveToWinners}
            onEdit={onEditAd}
            onDownload={handleDownload}
          />
        );
      })()}
    </div>
  );
}

type VariationsGridProps = {
  results: VariationResult[];
  productName?: string;
  savedWinnerIds: Set<string>;
  savingWinnerIds: Set<string>;
  onSaveWinner: (generationId: string) => void;
  onEdit?: (generationId: string) => void;
  onDownload: (generationId: string, imageUrl: string) => void;
  onZoom: (index: number) => void;
};

function VariationsGrid({
  results,
  productName,
  savedWinnerIds,
  savingWinnerIds,
  onSaveWinner,
  onEdit,
  onDownload,
  onZoom,
}: VariationsGridProps) {
  // 1 → single full tile; 2/3/4 → 2 columns; 5 → 3 columns
  const gridCols =
    results.length <= 1
      ? "grid-cols-1"
      : results.length <= 4
        ? "grid-cols-2"
        : "grid-cols-3";

  return (
    <div className="w-full">
      <div className={cn("grid gap-3", gridCols)}>
        {results.map((variation, i) => (
          <VariationTile
            key={variation.id}
            variation={variation}
            index={i}
            total={results.length}
            productName={productName}
            isSaved={savedWinnerIds.has(variation.id)}
            isSaving={savingWinnerIds.has(variation.id)}
            onSaveWinner={() => onSaveWinner(variation.id)}
            onEdit={onEdit ? () => onEdit(variation.id) : undefined}
            onDownload={(url) => onDownload(variation.id, url)}
            onZoom={() => onZoom(i)}
          />
        ))}
      </div>
    </div>
  );
}

type VariationTileProps = {
  variation: VariationResult;
  index: number;
  total: number;
  productName?: string;
  isSaved: boolean;
  isSaving: boolean;
  onSaveWinner: () => void;
  onEdit?: () => void;
  onDownload: (imageUrl: string) => void;
  onZoom: () => void;
};

function VariationTile({
  variation,
  index,
  total,
  productName,
  isSaved,
  isSaving,
  onSaveWinner,
  onEdit,
  onDownload,
  onZoom,
}: VariationTileProps) {
  const showBadge = total > 1;
  const stop = (handler: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler();
  };

  if (variation.status === "pending") {
    // Pick the right copy based on which step of the chain we're in. The
    // server returns kieState='waiting-source' while Nano Banana is still
    // running; once GPT Image 2 has been fired the row's kieJobId is set
    // and we get the regular kieState values.
    const pendingLabel =
      variation.kieState === "waiting-source"
        ? "Generating variation…"
        : "Refining for product consistency…";
    return (
      <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted/30">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted/40 via-muted/20 to-muted/40" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/60 text-center px-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-[11px]">{pendingLabel}</p>
        </div>
        {showBadge && (
          <span className="absolute top-2 left-2 rounded-md bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-white">
            {index + 1}/{total}
          </span>
        )}
      </div>
    );
  }

  if (variation.status === "error") {
    return (
      <div className="relative aspect-square overflow-hidden rounded-xl border border-red-500/30 bg-red-500/5">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-red-500">
          <AlertCircle className="h-6 w-6" />
          <p className="text-[11px] text-center line-clamp-3">
            {variation.errorMessage || "Failed"}
          </p>
        </div>
        {showBadge && (
          <span className="absolute top-2 left-2 rounded-md bg-red-500/80 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-white">
            {index + 1}/{total}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onZoom}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onZoom();
        }
      }}
      className="group relative overflow-hidden rounded-xl border border-border bg-muted/10 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      {variation.imageUrl && (
        <img
          src={variation.imageUrl}
          alt={productName ? `${productName} variation ${index + 1}` : `Variation ${index + 1}`}
          className="w-full h-auto object-contain"
        />
      )}
      {showBadge && (
        <span className="absolute top-2 left-2 rounded-md bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-white">
          {index + 1}/{total}
        </span>
      )}
      <span className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
        <Maximize2 className="h-3 w-3" />
        Zoom
      </span>
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={stop(onSaveWinner)}
            disabled={isSaving || isSaved}
            title={isSaved ? "Saved as Winner" : "Save as Winner"}
            className={cn(
              "flex items-center gap-1 rounded-md backdrop-blur-sm px-2 py-1 text-[10px] font-medium transition-colors",
              isSaved
                ? "bg-primary/30 text-primary cursor-default"
                : "bg-white/20 text-white hover:bg-white/30"
            )}
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isSaved ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Trophy className="h-3 w-3" />
            )}
            {isSaved ? "Winner!" : "Winner"}
          </button>
          {onEdit && (
            <button
              onClick={stop(onEdit)}
              title="Edit text"
              className="flex items-center gap-1 rounded-md bg-white/20 backdrop-blur-sm px-2 py-1 text-[10px] font-medium text-white hover:bg-white/30 transition-colors"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (variation.imageUrl) onDownload(variation.imageUrl);
            }}
            title="Download"
            className="flex items-center gap-1 rounded-md bg-white/20 backdrop-blur-sm px-2 py-1 text-[10px] font-medium text-white hover:bg-white/30 transition-colors"
          >
            <DownloadIcon className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

type VariationLightboxProps = {
  results: VariationResult[];
  index: number;
  productName?: string;
  savedWinnerIds: Set<string>;
  savingWinnerIds: Set<string>;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSaveWinner: (generationId: string) => void;
  onEdit?: (generationId: string) => void;
  onDownload: (generationId: string, imageUrl: string) => void;
};

function VariationLightbox({
  results,
  index,
  productName,
  savedWinnerIds,
  savingWinnerIds,
  onClose,
  onPrev,
  onNext,
  onSaveWinner,
  onEdit,
  onDownload,
}: VariationLightboxProps) {
  const variation = results[index];
  const total = results.length;
  const hasMultiple = total > 1;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!hasMultiple) return;
      if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasMultiple, onPrev, onNext]);

  if (!variation) return null;

  const isSaved = savedWinnerIds.has(variation.id);
  const isSaving = savingWinnerIds.has(variation.id);
  const isCompleted = variation.status === "completed" && !!variation.imageUrl;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[92vw] max-h-[92vh] w-fit p-3 sm:p-4 gap-3 bg-background/95 backdrop-blur">
        <DialogTitle className="sr-only">
          {productName ? `${productName} — variation ${index + 1} of ${total}` : `Variation ${index + 1} of ${total}`}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Full-size preview of generated ad. Use arrow keys to navigate between variations.
        </DialogDescription>

        <div className="relative flex items-center justify-center">
          {hasMultiple && (
            <button
              onClick={onPrev}
              aria-label="Previous variation"
              className="absolute left-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          {isCompleted ? (
            <img
              src={variation.imageUrl}
              alt={productName ? `${productName} variation ${index + 1}` : `Variation ${index + 1}`}
              className="max-h-[80vh] max-w-[88vw] w-auto h-auto object-contain rounded-lg"
            />
          ) : variation.status === "error" ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-red-500">
              <AlertCircle className="h-10 w-10" />
              <p className="text-sm text-center max-w-md">
                {variation.errorMessage || "This variation failed to generate."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin" />
              <p className="text-sm">Still generating…</p>
            </div>
          )}

          {hasMultiple && (
            <button
              onClick={onNext}
              aria-label="Next variation"
              className="absolute right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs text-muted-foreground">
            {productName ? `${productName} · ` : ""}
            {hasMultiple ? `${index + 1} of ${total}` : "Variation"}
          </p>
          {isCompleted && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSaveWinner(variation.id)}
                disabled={isSaving || isSaved}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  isSaved
                    ? "bg-primary/15 text-primary cursor-default"
                    : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                )}
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isSaved ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Trophy className="h-3.5 w-3.5" />
                )}
                {isSaved ? "Winner!" : "Save as Winner"}
              </button>
              {onEdit && (
                <button
                  onClick={() => onEdit(variation.id)}
                  className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Text
                </button>
              )}
              <button
                onClick={() => variation.imageUrl && onDownload(variation.id, variation.imageUrl)}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 transition-all"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
