"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ImageIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Pencil,
  ScanText,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TextEditorBubbles, type EditableTextElement } from "./text-editor-bubbles";
import { StepProgress, type Step } from "./step-progress";

type Generation = {
  id: string;
  styleName: string | null;
  productName: string | null;
  imageUrl: string | null;
  status: string;
  createdAt: string;
};

type EditModeProps = {
  onGalleryRefresh: () => void;
  initialGenerationId?: string | null;
  onInitialHandled?: () => void;
};

type EditState =
  | { phase: "selecting" }
  | { phase: "extracting" }
  | { phase: "editing"; analysisJson: string; elements: EditableTextElement[]; imageUrl: string }
  | { phase: "applying"; currentStep: number }
  | { phase: "generating"; generationId: string; originalImageUrl: string }
  | { phase: "completed"; generationId: string; imageUrl: string; originalImageUrl: string }
  | { phase: "error"; message: string };

const APPLY_STEP_TIMINGS = [
  { delay: 0 },
  { delay: 10000 },
  { delay: 22000 },
];

function buildApplySteps(currentStep: number): Step[] {
  return [
    { label: "Generating edit command...", status: currentStep === 0 ? "active" : currentStep > 0 ? "complete" : "pending" },
    { label: "Submitting to image engine...", status: currentStep === 1 ? "active" : currentStep > 1 ? "complete" : "pending" },
    { label: "Regenerating image...", status: currentStep >= 2 ? "active" : "pending" },
  ];
}

export function EditMode({ onGalleryRefresh, initialGenerationId, onInitialHandled }: EditModeProps) {
  const [state, setState] = useState<EditState>({ phase: "selecting" });
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingGallery, setLoadingGallery] = useState(true);
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Load completed generations
  useEffect(() => {
    setLoadingGallery(true);
    fetch("/api/static-ads/gallery?status=completed")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setGenerations(data);
      })
      .catch(console.error)
      .finally(() => setLoadingGallery(false));
  }, []);

  useEffect(() => {
    return () => stepTimersRef.current.forEach(clearTimeout);
  }, []);

  // Poll for Kie completion
  useEffect(() => {
    if (state.phase !== "generating") return;
    const { generationId, originalImageUrl } = state;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/static-ads/generate/${generationId}`);
        const data = await res.json();
        if (data.status === "completed" && data.imageUrl) {
          setState({ phase: "completed", generationId, imageUrl: data.imageUrl, originalImageUrl });
          onGalleryRefresh();
          setTimeout(() => { fetch(`/api/static-ads/generate/${generationId}`).catch(() => {}); }, 2000);
        } else if (data.status === "error") {
          setState({ phase: "error", message: data.errorMessage || "Image generation failed" });
        }
      } catch { /* transient */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [state, onGalleryRefresh]);

  // Handle ad selection → run extraction
  const handleSelect = useCallback(async (gen: Generation) => {
    setSelectedId(gen.id);
    setState({ phase: "extracting" });

    try {
      const res = await fetch("/api/static-ads/edit/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: gen.id }),
      });

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        setState({ phase: "error", message: `Server error (${res.status})` });
        return;
      }

      if (!res.ok || data.error) {
        setState({ phase: "error", message: (data.error as string) || "Extraction failed" });
        return;
      }

      const textElements = (data.textElements as Array<{ name: string; currentText: string; editPriority: string }>).map(
        (el) => ({
          ...el,
          newText: el.currentText,
          editPriority: el.editPriority as EditableTextElement["editPriority"],
        })
      );

      setState({
        phase: "editing",
        analysisJson: data.analysisJson as string,
        elements: textElements,
        imageUrl: data.imageUrl as string,
      });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "Network error" });
    }
  }, []);

  // Auto-select and extract when coming from Create tab's "Edit Text" button
  const initialHandledRef = useRef(false);
  useEffect(() => {
    if (!initialGenerationId || initialHandledRef.current || loadingGallery) return;
    const gen = generations.find((g) => g.id === initialGenerationId);
    if (gen) {
      initialHandledRef.current = true;
      onInitialHandled?.();
      handleSelect(gen);
    }
  }, [initialGenerationId, generations, loadingGallery, handleSelect, onInitialHandled]);

  // Handle edit element change
  const handleElementChange = useCallback((index: number, newText: string) => {
    setState((prev) => {
      if (prev.phase !== "editing") return prev;
      const elements = [...prev.elements];
      elements[index] = { ...elements[index], newText };
      return { ...prev, elements };
    });
  }, []);

  // Handle "Start Edit" → run Agent 3 + Kie
  const handleApplyEdits = useCallback(async () => {
    if (state.phase !== "editing" || !selectedId) return;

    const { analysisJson, elements, imageUrl } = state;
    const changedEdits = elements
      .filter((el) => el.newText !== el.currentText && el.editPriority !== "do-not-edit")
      .map((el) => ({ name: el.name, newText: el.newText }));

    if (changedEdits.length === 0) return;

    setState({ phase: "applying", currentStep: 0 });

    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = APPLY_STEP_TIMINGS.slice(1).map((s, i) =>
      setTimeout(() => {
        setState((prev) =>
          prev.phase === "applying" ? { phase: "applying", currentStep: i + 1 } : prev
        );
      }, s.delay)
    );

    try {
      const res = await fetch("/api/static-ads/edit/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: selectedId, analysisJson, edits: changedEdits }),
      });

      stepTimersRef.current.forEach(clearTimeout);

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        setState({ phase: "error", message: res.status === 504 ? "Request timed out" : `Server error (${res.status})` });
        return;
      }

      if (!res.ok || data.error) {
        setState({ phase: "error", message: (data.error as string) || "Edit failed" });
        return;
      }

      setState({
        phase: "generating",
        generationId: data.generationId as string,
        originalImageUrl: imageUrl,
      });
    } catch (err) {
      stepTimersRef.current.forEach(clearTimeout);
      setState({ phase: "error", message: err instanceof Error ? err.message : "Network error" });
    }
  }, [state, selectedId]);

  const resetToSelecting = () => {
    stepTimersRef.current.forEach(clearTimeout);
    setSelectedId(null);
    setState({ phase: "selecting" });
  };

  const isProcessing = state.phase === "extracting" || state.phase === "applying" || state.phase === "generating";
  const hasChanges = state.phase === "editing" && state.elements.some((el) => el.newText !== el.currentText && el.editPriority !== "do-not-edit");

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6">
      {/* LEFT panel */}
      <div className="flex flex-col gap-4 lg:w-[480px] lg:shrink-0">
        {/* Step 1: Pick an ad */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              1. Choose an Ad to Edit
            </h3>
            {selectedId && (
              <button
                onClick={resetToSelecting}
                disabled={isProcessing}
                className="ml-auto text-[10px] text-primary hover:underline disabled:opacity-50"
              >
                Change
              </button>
            )}
          </div>

          {!selectedId ? (
            loadingGallery ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30" />
              </div>
            ) : generations.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-6 text-center">
                No completed ads yet. Generate some first.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto pr-1">
                {generations.map((gen) => (
                  <button
                    key={gen.id}
                    onClick={() => handleSelect(gen)}
                    disabled={isProcessing}
                    className="rounded-lg border-2 border-border hover:border-primary/40 overflow-hidden transition-all disabled:opacity-50"
                  >
                    <div className="aspect-square bg-muted">
                      {gen.imageUrl && (
                        <img src={gen.imageUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="px-1.5 py-1">
                      <p className="text-[8px] text-muted-foreground truncate">
                        {gen.productName}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-muted/30 p-2">
              <div className="h-12 w-12 shrink-0 rounded-lg overflow-hidden bg-muted">
                {state.phase === "editing" || state.phase === "applying" || state.phase === "generating" || state.phase === "completed" ? (
                  <img
                    src={
                      state.phase === "editing" ? state.imageUrl :
                      state.phase === "completed" ? state.originalImageUrl :
                      generations.find((g) => g.id === selectedId)?.imageUrl || ""
                    }
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-foreground">
                  {generations.find((g) => g.id === selectedId)?.productName || "Selected Ad"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {generations.find((g) => g.id === selectedId)?.styleName}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Step 2: Edit text elements */}
        {(state.phase === "editing" || state.phase === "applying") && (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Pencil className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                2. Edit Text Elements
              </h3>
            </div>

            {state.phase === "editing" && (
              <div className="max-h-[400px] overflow-y-auto pr-1">
                <TextEditorBubbles
                  elements={state.elements}
                  onChange={handleElementChange}
                  disabled={false}
                />
              </div>
            )}
          </section>
        )}

        {/* Start Edit button */}
        {state.phase === "editing" && (
          <button
            onClick={handleApplyEdits}
            disabled={!hasChanges}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200",
              hasChanges
                ? "bg-primary text-primary-foreground hover:brightness-110 shadow-[0_0_20px_rgba(178,255,0,0.2)]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <Wand2 className="h-4 w-4" />
            Start Edit
          </button>
        )}

        {/* Error */}
        {state.phase === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-red-500">{state.message}</p>
              <button onClick={resetToSelecting} className="mt-1 text-[11px] text-red-400 hover:underline">
                Start over
              </button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT panel */}
      <div className="flex-1 min-w-0">
        <div className="sticky top-6 rounded-xl border border-border bg-card overflow-hidden min-h-[400px] flex items-center justify-center">
          {/* Completed — side by side */}
          {state.phase === "completed" ? (
            <div className="w-full p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <p className="text-xs font-semibold text-foreground">Edit Complete</p>
                <button
                  onClick={resetToSelecting}
                  className="ml-auto text-[10px] text-primary hover:underline"
                >
                  Edit another
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] text-muted-foreground mb-1 uppercase tracking-wider">Original</p>
                  <img src={state.originalImageUrl} alt="Original" className="w-full rounded-lg" />
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground mb-1 uppercase tracking-wider">Edited</p>
                  <img src={state.imageUrl} alt="Edited" className="w-full rounded-lg" />
                </div>
              </div>
            </div>
          ) : state.phase === "extracting" ? (
            <div className="flex flex-col items-center gap-4 p-10">
              <ScanText className="h-10 w-10 text-primary/30 animate-pulse" />
              <p className="text-sm text-muted-foreground">Extracting text elements...</p>
              <p className="text-[11px] text-muted-foreground/60">AI is analyzing the image — typically 15–30 seconds</p>
            </div>
          ) : state.phase === "editing" ? (
            <div className="w-full">
              <img src={state.imageUrl} alt="Selected ad" className="w-full" />
            </div>
          ) : state.phase === "applying" || state.phase === "generating" ? (
            <div className="flex flex-col items-center gap-6 p-10 w-full max-w-sm">
              <div className="rounded-2xl border border-border bg-muted/20 p-6 w-full">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                  Edit Progress
                </p>
                <StepProgress
                  steps={
                    state.phase === "generating"
                      ? buildApplySteps(2)
                      : buildApplySteps(state.currentStep)
                  }
                />
              </div>
              <p className="text-[11px] text-muted-foreground/60 text-center">
                {state.phase === "applying" ? "Preparing edit — typically 15–25 seconds" : "Generating edited image — typically 30–60 seconds"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-10 text-muted-foreground/40">
              <Pencil className="h-12 w-12" />
              <p className="text-sm">Select an ad to edit its text</p>
              <p className="text-[11px] text-muted-foreground/30 text-center max-w-xs">
                Choose a completed ad from the grid, then edit any text elements
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
