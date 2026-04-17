"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Video,
  User,
  Film,
  Mic,
  Package,
  Users,
  Clock,
  RectangleHorizontal,
  Zap,
  Sparkles,
  ArrowLeft,
  Lock,
  ImageIcon,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Camera,
  Radio,
  Monitor,
  Bug,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";
import { StepProgress, type Step } from "@/components/static-ads/step-progress";
import { useGenerationTracker } from "@/lib/video-generation/generation-tracker";

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
  imagePreviewUrl: string | null;
  videoImageUrl: string | null;
  videoImagePreviewUrl: string | null;
};

type Character = {
  id: string;
  name: string;
  imageUrl: string;
  imagePreviewUrl: string;
};

type Scene = {
  id: string;
  name: string;
  imageUrl: string;
  imagePreviewUrl: string;
};

type VideoType = "ugc" | "broll" | "aroll";
type ArollStyle = "street-interview" | "talking-head" | "podcast" | "green-screen";

type VideoGeneratorProps = {
  products: Product[];
  onGalleryRefresh?: () => void;
};

type PipelineState =
  | { phase: "idle" }
  | { phase: "pipeline"; currentStep: number }
  | { phase: "generating"; generationId: string }
  | { phase: "completed"; generationId: string; videoUrl: string }
  | { phase: "error"; message: string; failedStep?: number };

type PipelineDebugData = {
  crafterPrompt?: string;
  studioFlowPrompt?: string;
  cleanedPrompt?: string;
  finalPrompt?: string;
  voiceCleanedPrompt?: string;
};

const VIDEO_TYPES = [
  {
    key: "ugc" as const,
    label: "UGC",
    icon: User,
    description: "Creator-style ads with talent",
    detail: "AI-generated UGC-style video ads featuring virtual creators presenting your product",
    available: true,
  },
  {
    key: "broll" as const,
    label: "B-Roll",
    icon: Film,
    description: "Cinematic product footage",
    detail: "Ultra-premium CGI product hero sequences with macro cinema simulation",
    available: true,
  },
  {
    key: "aroll" as const,
    label: "A-Roll",
    icon: Mic,
    description: "Interview & presenter styles",
    detail: "Street interviews, talking heads, podcasts, and green screen presenters",
    available: true,
  },
];

const AROLL_STYLES = [
  {
    key: "street-interview" as ArollStyle,
    label: "Street Interview",
    icon: MessageSquare,
    description: "Two-subject viral street clip",
    available: true,
  },
  {
    key: "talking-head" as ArollStyle,
    label: "Talking Head",
    icon: Camera,
    description: "Direct-to-camera presenter",
    available: true,
  },
  {
    key: "podcast" as ArollStyle,
    label: "Podcast",
    icon: Radio,
    description: "Studio podcast clip format",
    available: true,
  },
  {
    key: "green-screen" as ArollStyle,
    label: "Green Screen",
    icon: Monitor,
    description: "Presenter with virtual background",
    available: true,
  },
];

const LENGTH_OPTIONS = [
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
  { value: "15", label: "15s" },
];

const SIZE_OPTIONS = [
  { value: "9:16", label: "9:16", widthClass: "w-2.5 h-[18px]" },
  { value: "16:9", label: "16:9", widthClass: "w-[18px] h-2.5" },
];

const STEP_LABELS_DEFAULT = [
  "Crafting prompt...",
  "Generating video prompt...",
  "Cleaning prompt...",
  "Formatting template...",
  "Submitting to Seedance...",
  "Generating video...",
];

const STEP_LABELS_AROLL = [
  "Crafting prompt...",
  "Generating video prompt...",
  "Cleaning prompt...",
  "Formatting template...",
  "Cleaning voice dialogue...",
  "Submitting to Seedance...",
  "Generating video...",
];

function buildSteps(currentStep: number, isAroll: boolean, failedStep?: number): Step[] {
  const labels = isAroll ? STEP_LABELS_AROLL : STEP_LABELS_DEFAULT;

  return labels.map((label, i) => {
    if (failedStep !== undefined && i === failedStep - 1) {
      return { label, status: "error" as const };
    }
    if (i < currentStep) return { label, status: "complete" as const };
    if (i === currentStep) return { label, status: "active" as const };
    return { label, status: "pending" as const };
  });
}

function DebugStep({ label, content }: { label: string; content?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!content) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <p className="text-[10px] font-medium text-muted-foreground/40">{label}</p>
        <p className="text-[10px] text-muted-foreground/30 italic">Waiting...</p>
      </div>
    );
  }
  const preview = content.slice(0, 150);
  const hasMore = content.length > 150;

  return (
    <div className="rounded-lg border border-amber-500/10 bg-background px-3 py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left"
      >
        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
        <p className="text-[10px] font-semibold text-foreground/80">{label}</p>
        {hasMore && (
          expanded
            ? <ChevronDown className="h-3 w-3 text-muted-foreground/40 ml-auto" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground/40 ml-auto" />
        )}
      </button>
      <pre className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words font-mono max-h-[300px] overflow-y-auto">
        {expanded || !hasMore ? content : `${preview}...`}
      </pre>
    </div>
  );
}

export function VideoGenerator({ products, onGalleryRefresh }: VideoGeneratorProps) {
  const { trackGeneration } = useGenerationTracker();
  const { clientId } = useClient();
  const [selectedType, setSelectedType] = useState<VideoType | null>(null);
  const [selectedArollStyle, setSelectedArollStyle] = useState<ArollStyle | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedLength, setSelectedLength] = useState("15");
  const [selectedSize, setSelectedSize] = useState("9:16");
  const [script, setScript] = useState("");
  const [state, setState] = useState<PipelineState>({ phase: "idle" });
  const [debugData, setDebugData] = useState<PipelineDebugData>({});
  const [showDebug, setShowDebug] = useState(false);
  const stepTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const selectedCharacter = characters.find((c) => c.id === selectedCharacterId);

  const isAroll = selectedType === "aroll";
  const isBroll = selectedType === "broll";
  const isPodcast = isAroll && selectedArollStyle === "podcast";
  const showCharacters = selectedType === "ugc" || isPodcast;
  const showScenes = isPodcast;
  const isTalkingHead = isAroll && selectedArollStyle === "talking-head";
  const showProducts = !isPodcast && !isTalkingHead;
  const productOptional = isAroll;

  const hasVideoImage = (p: Product) => !!p.videoImageUrl;
  const isProcessing = state.phase === "pipeline" || state.phase === "generating";
  const canGenerate =
    (productOptional || (selectedProductId && selectedProduct?.videoImageUrl)) &&
    (selectedType === "ugc" || selectedType === "broll" || (isAroll && selectedArollStyle)) &&
    script.trim() &&
    !isProcessing;

  useEffect(() => {
    return () => stepTimersRef.current.forEach(clearTimeout);
  }, []);

  // Fetch characters and scenes (scoped by clientId)
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/characters?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCharacters(data); })
      .catch(console.error);
    fetch(`/api/scenes?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setScenes(data); })
      .catch(console.error);
  }, [clientId]);

  // Poll for video generation completion
  useEffect(() => {
    if (state.phase !== "generating") return;
    const { generationId } = state;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/video-generation/generate/${generationId}`);
        const data = await res.json();

        // Capture debug data from every poll
        setDebugData({
          crafterPrompt: data.crafterPrompt || undefined,
          studioFlowPrompt: data.studioFlowPrompt || undefined,
          cleanedPrompt: data.cleanedPrompt || undefined,
          finalPrompt: data.finalPrompt || undefined,
          voiceCleanedPrompt: data.voiceCleanedPrompt || undefined,
        });

        if (data.status === "completed" && (data.videoPreviewUrl || data.videoUrl)) {
          setState({
            phase: "completed",
            generationId,
            videoUrl: data.videoPreviewUrl || data.videoUrl,
          });
          onGalleryRefresh?.();
        } else if (data.status === "error") {
          setState({
            phase: "error",
            message: data.errorMessage || "Video generation failed",
          });
        }
      } catch {
        // Transient
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [state, onGalleryRefresh]);

  const handleGenerate = useCallback(async () => {
    if (!script.trim()) return;
    if (!productOptional && !selectedProductId) return;

    setState({ phase: "pipeline", currentStep: 0 });
    setDebugData({});

    stepTimersRef.current.forEach(clearTimeout);
    const timings = [3000, 20000, 30000, 45000];
    if (isAroll) timings.push(55000);
    stepTimersRef.current = timings.map((delay, i) =>
      setTimeout(() => {
        setState((prev) =>
          prev.phase === "pipeline"
            ? { phase: "pipeline", currentStep: i + 1 }
            : prev
        );
      }, delay)
    );

    try {
      const res = await fetch("/api/video-generation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          productId: selectedProductId || undefined,
          characterId: showCharacters && !isPodcast ? (selectedCharacterId || undefined) : undefined,
          characterIds: isPodcast && selectedCharacterIds.length > 0 ? selectedCharacterIds : undefined,
          sceneId: showScenes ? (selectedSceneId || undefined) : undefined,
          script: script.trim(),
          duration: Number(selectedLength),
          aspectRatio: selectedSize,
          hasCharacter: showCharacters ? (isPodcast ? selectedCharacterIds.length > 0 : !!selectedCharacterId) : false,
          videoType: selectedType,
          arollStyle: isAroll ? selectedArollStyle : undefined,
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
          message: res.status === 504
            ? "Request timed out — the pipeline took too long."
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

      const genId = data.generationId as string;
      setState({ phase: "generating", generationId: genId });

      // Register with global generation tracker for cross-page visibility
      trackGeneration({
        id: genId,
        productName: selectedProduct?.name || null,
        videoType: selectedType || "ugc",
        arollStyle: isAroll ? selectedArollStyle || undefined : undefined,
        status: "processing",
      });

      // Fetch debug data immediately (prompts are already written by the API)
      try {
        const debugRes = await fetch(`/api/video-generation/generate/${data.generationId}`);
        const debugJson = await debugRes.json();
        setDebugData({
          crafterPrompt: debugJson.crafterPrompt || undefined,
          studioFlowPrompt: debugJson.studioFlowPrompt || undefined,
          cleanedPrompt: debugJson.cleanedPrompt || undefined,
          finalPrompt: debugJson.finalPrompt || undefined,
          voiceCleanedPrompt: debugJson.voiceCleanedPrompt || undefined,
        });
      } catch { /* non-critical */ }
    } catch (err) {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [selectedProductId, selectedCharacterId, selectedCharacterIds, selectedSceneId, selectedType, selectedArollStyle, showCharacters, showScenes, isPodcast, productOptional, isAroll, script, selectedLength, selectedSize]);

  const resetState = () => {
    stepTimersRef.current.forEach(clearTimeout);
    stepTimersRef.current = [];
    setState({ phase: "idle" });
  };

  const totalSteps = isAroll ? STEP_LABELS_AROLL.length : STEP_LABELS_DEFAULT.length;
  const currentSteps: Step[] =
    state.phase === "pipeline"
      ? buildSteps(state.currentStep, isAroll)
      : state.phase === "generating"
        ? buildSteps(totalSteps - 1, isAroll)
        : state.phase === "error" && state.failedStep
          ? buildSteps(0, isAroll, state.failedStep)
          : [];

  // Phase 1: Video Type Selection
  if (!selectedType) {
    return (
      <div className="p-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Choose Video Type
            </h2>
            <p className="text-sm text-muted-foreground">
              Select the type of video you want to generate
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {VIDEO_TYPES.map((type) => (
              <button
                key={type.key}
                onClick={() => type.available && setSelectedType(type.key)}
                disabled={!type.available}
                className={cn(
                  "group relative flex flex-col items-center gap-4 rounded-2xl border-2 p-8 text-center transition-all duration-200",
                  type.available
                    ? "border-border hover:border-primary hover:bg-primary/5 hover:shadow-[0_0_30px_rgba(178,255,0,0.1)] cursor-pointer"
                    : "border-border/50 opacity-50 cursor-not-allowed"
                )}
              >
                {!type.available && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-medium text-muted-foreground">
                      Coming Soon
                    </span>
                  </div>
                )}
                <div className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-200",
                  type.available
                    ? "bg-primary/10 text-primary group-hover:bg-primary/20 group-hover:scale-110"
                    : "bg-muted text-muted-foreground"
                )}>
                  <type.icon className="h-8 w-8" />
                </div>
                <div>
                  <h3 className={cn("text-base font-semibold mb-1", type.available ? "text-foreground" : "text-muted-foreground")}>
                    {type.label}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{type.description}</p>
                </div>
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{type.detail}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Phase 1.5: A-Roll Style Selection
  if (isAroll && !selectedArollStyle) {
    return (
      <div className="p-6">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => setSelectedType(null)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit mb-6"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to video types
          </button>

          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Mic className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">
                Choose A-Roll Style
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Select the interview or presenter format
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {AROLL_STYLES.map((style) => (
              <button
                key={style.key}
                onClick={() => style.available && setSelectedArollStyle(style.key)}
                disabled={!style.available}
                className={cn(
                  "group relative flex flex-col items-center gap-3 rounded-2xl border-2 p-6 text-center transition-all duration-200",
                  style.available
                    ? "border-border hover:border-primary hover:bg-primary/5 hover:shadow-[0_0_30px_rgba(178,255,0,0.1)] cursor-pointer"
                    : "border-border/50 opacity-50 cursor-not-allowed"
                )}
              >
                {!style.available && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                    <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[9px] font-medium text-muted-foreground">Soon</span>
                  </div>
                )}
                <div className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200",
                  style.available
                    ? "bg-primary/10 text-primary group-hover:bg-primary/20 group-hover:scale-110"
                    : "bg-muted text-muted-foreground"
                )}>
                  <style.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className={cn("text-sm font-semibold mb-0.5", style.available ? "text-foreground" : "text-muted-foreground")}>
                    {style.label}
                  </h3>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{style.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Type badge config
  const arollBadgeMap: Record<string, { label: string; detail: string }> = {
    "street-interview": { label: "A-Roll · Street Interview", detail: "Two-subject viral street clip" },
    "talking-head": { label: "A-Roll · Talking Head", detail: "Direct-to-camera portrait" },
    "podcast": { label: "A-Roll · Podcast", detail: "Multi-cut studio podcast clip" },
    "green-screen": { label: "A-Roll · Green Screen", detail: "Talking head + product hero plates" },
  };
  const arollBadgeLabel = arollBadgeMap[selectedArollStyle || ""]?.label || "A-Roll";
  const arollBadgeDetail = arollBadgeMap[selectedArollStyle || ""]?.detail || "";
  const typeBadge = isAroll
    ? { icon: Mic, label: arollBadgeLabel, detail: arollBadgeDetail }
    : isBroll
      ? { icon: Film, label: "B-Roll Video", detail: "CGI product hero sequence" }
      : { icon: User, label: "UGC Video", detail: "Creator-style ad with talent" };

  // Summary line
  const typeLabel = isAroll ? "A-Roll" : isBroll ? "B-Roll" : "UGC";
  const productLabel = selectedProduct?.name || (productOptional ? "No product ref" : "No product selected");
  const talentLabel = showCharacters ? (selectedCharacter ? selectedCharacter.name : "AI-selected talent") : "";

  // Dynamic section numbering
  let nextSection = 1;
  const productSectionNum = showProducts ? nextSection++ : 0;
  const characterSectionNum = showCharacters ? nextSection++ : 0;
  const sceneSectionNum = showScenes ? nextSection++ : 0;
  const lengthSectionNum = nextSection++;
  const sizeSectionNum = nextSection++;
  const scriptSectionNum = nextSection++;
  const generateSectionNum = nextSection++;

  // Phase 2: Configuration
  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6">
      {/* LEFT: stacked modules */}
      <div className="flex flex-col gap-4 lg:w-[480px] lg:shrink-0">
        {/* Back button */}
        <button
          onClick={() => {
            if (isAroll) {
              setSelectedArollStyle(null);
            } else {
              setSelectedType(null);
            }
            setSelectedProductId("");
            setSelectedCharacterId("");
            setSelectedCharacterIds([]);
            setSelectedSceneId("");
            setSelectedLength("15");
            setSelectedSize("9:16");
            setScript("");
            resetState();
          }}
          disabled={isProcessing}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit disabled:opacity-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {isAroll ? "Back to A-Roll styles" : "Back to video types"}
        </button>

        {/* Type badge */}
        <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2">
          <typeBadge.icon className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-primary">{typeBadge.label}</span>
          <span className="text-[10px] text-primary/60">{typeBadge.detail}</span>
        </div>

        {/* 1. Product picker (hidden for podcast) */}
        {showProducts && <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              1. Choose Product {productOptional && <span className="text-muted-foreground/50 normal-case font-normal">(optional)</span>}
            </h3>
          </div>
          <div className="grid grid-cols-4 gap-2 max-h-[240px] overflow-y-auto pr-1">
            {/* None option for A-Roll */}
            {productOptional && (
              <button
                onClick={() => setSelectedProductId("")}
                disabled={isProcessing}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                  !selectedProductId
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                  <Package className="h-4 w-4 text-muted-foreground/40" />
                </div>
                <span className={cn("text-[9px] leading-tight font-medium", !selectedProductId ? "text-primary" : "text-muted-foreground")}>
                  None
                </span>
              </button>
            )}
            {products.map((p) => {
              const isSelected = selectedProductId === p.id;
              const hasVideo = hasVideoImage(p);
              const displayImage = p.videoImagePreviewUrl || p.imagePreviewUrl;
              return (
                <button
                  key={p.id}
                  onClick={() => hasVideo && setSelectedProductId(p.id)}
                  disabled={!hasVideo || isProcessing}
                  title={hasVideo ? p.name : "Upload a 9:16 video image in Brand Intelligence to enable"}
                  className={cn(
                    "relative flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                    !hasVideo && "opacity-40 cursor-not-allowed",
                    isSelected ? "border-primary bg-primary/5" : hasVideo ? "border-border hover:border-primary/40" : "border-border/50",
                    isProcessing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {!hasVideo && (
                    <div className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted">
                      <Video className="h-2.5 w-2.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {displayImage ? (
                      <img src={displayImage} alt={p.name} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                  <span className={cn("text-[9px] leading-tight font-medium line-clamp-2", isSelected ? "text-primary" : "text-muted-foreground")}>
                    {p.name}
                  </span>
                </button>
              );
            })}
          </div>
          {!productOptional && products.length > 0 && products.every((p) => !p.videoImageUrl) && (
            <p className="mt-2 text-[10px] text-muted-foreground/60 text-center">
              Upload 9:16 video images for your products in Brand Intelligence to enable selection
            </p>
          )}
        </section>}

        {/* 2. Character (Optional — UGC single-select, Podcast multi-select up to 2) */}
        {showCharacters && <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {characterSectionNum}. {isPodcast ? "Characters" : "Character"} <span className="text-muted-foreground/50 normal-case font-normal">(optional{isPodcast ? ", up to 2" : ""})</span>
            </h3>
          </div>
          {characters.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground/40">
              <Users className="h-8 w-8" />
              <p className="text-xs text-muted-foreground/60">No characters yet</p>
              <p className="text-[10px] text-muted-foreground/40 text-center max-w-[240px]">
                Add character references in the Characters tab to use them here.
              </p>
            </div>
          ) : isPodcast ? (
            /* Podcast: multi-select up to 2 */
            <div>
              {selectedCharacterIds.length > 0 && (
                <p className="text-[10px] text-primary mb-2">{selectedCharacterIds.length}/2 selected</p>
              )}
              <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto pr-1">
                {characters.map((c) => {
                  const isSelected = selectedCharacterIds.includes(c.id);
                  const atMax = selectedCharacterIds.length >= 2 && !isSelected;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedCharacterIds((prev) => prev.filter((id) => id !== c.id));
                        } else if (!atMax) {
                          setSelectedCharacterIds((prev) => [...prev, c.id]);
                        }
                      }}
                      disabled={isProcessing || atMax}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                        isSelected ? "border-primary bg-primary/5" : atMax ? "border-border/50 opacity-40" : "border-border hover:border-primary/40",
                        isProcessing && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                        <img src={c.imagePreviewUrl} alt={c.name} className="h-full w-full object-cover" />
                        {isSelected && (
                          <div className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                            <span className="text-[8px] font-bold text-primary-foreground">{selectedCharacterIds.indexOf(c.id) + 1}</span>
                          </div>
                        )}
                      </div>
                      <span className={cn("text-[9px] leading-tight font-medium line-clamp-2", isSelected ? "text-primary" : "text-muted-foreground")}>
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* UGC: single-select */
            <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto pr-1">
              <button
                onClick={() => setSelectedCharacterId("")}
                disabled={isProcessing}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                  !selectedCharacterId
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                  <Users className="h-4 w-4 text-muted-foreground/40" />
                </div>
                <span className={cn("text-[9px] leading-tight font-medium", !selectedCharacterId ? "text-primary" : "text-muted-foreground")}>
                  None
                </span>
              </button>
              {characters.map((c) => {
                const isSelected = selectedCharacterId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCharacterId(c.id)}
                    disabled={isProcessing}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                      isProcessing && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                      <img src={c.imagePreviewUrl} alt={c.name} className="h-full w-full object-cover" />
                    </div>
                    <span className={cn("text-[9px] leading-tight font-medium line-clamp-2", isSelected ? "text-primary" : "text-muted-foreground")}>
                      {c.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>}

        {/* Scenes (Optional — Podcast only) */}
        {showScenes && <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {sceneSectionNum}. Scene Background <span className="text-muted-foreground/50 normal-case font-normal">(optional)</span>
            </h3>
          </div>
          {scenes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground/40">
              <ImageIcon className="h-8 w-8" />
              <p className="text-xs text-muted-foreground/60">No scenes yet</p>
              <p className="text-[10px] text-muted-foreground/40 text-center max-w-[240px]">
                Upload studio/background images in the Scenes library to use them here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto pr-1">
              <button
                onClick={() => setSelectedSceneId("")}
                disabled={isProcessing}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                  !selectedSceneId
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                  <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                </div>
                <span className={cn("text-[9px] leading-tight font-medium", !selectedSceneId ? "text-primary" : "text-muted-foreground")}>
                  None
                </span>
              </button>
              {scenes.map((s) => {
                const isSelected = selectedSceneId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSceneId(s.id)}
                    disabled={isProcessing}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-150 text-center",
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                      isProcessing && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                      <img src={s.imagePreviewUrl} alt={s.name} className="h-full w-full object-cover" />
                    </div>
                    <span className={cn("text-[9px] leading-tight font-medium line-clamp-2", isSelected ? "text-primary" : "text-muted-foreground")}>
                      {s.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>}

        {/* Length */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{lengthSectionNum}. Length</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {LENGTH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedLength(opt.value)}
                disabled={isProcessing}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border-2 px-4 py-2.5 text-xs font-medium transition-all",
                  selectedLength === opt.value ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Size */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <RectangleHorizontal className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{sizeSectionNum}. Size</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedSize(opt.value)}
                disabled={isProcessing}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border-2 px-4 py-2.5 text-xs font-medium transition-all",
                  selectedSize === opt.value ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
                  isProcessing && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className={cn("border border-current rounded-sm", opt.widthClass)} />
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Script */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{scriptSectionNum}. Prompt + Script</h3>
          </div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            disabled={isProcessing}
            placeholder={isAroll
              ? "Describe the street interview scene... e.g. 'A street interview about a new energy drink. The interviewer asks a passerby what keeps them going during long workdays.'"
              : "Describe the scene and include the script... e.g. 'A girl in a bright bathroom holding the product, smiling at camera. Script: Adding this serum to my nighttime routine was the best decision.'"
            }
            rows={4}
            className={cn(
              "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50",
              isProcessing && "opacity-50 cursor-not-allowed"
            )}
          />
          {script.trim() && (
            <p className="mt-1.5 text-[10px] text-muted-foreground/50">
              {script.trim().length} characters
            </p>
          )}
        </section>

        {/* Summary + Generate */}
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{generateSectionNum}. Generate</h3>
          </div>

          <div className="flex items-center gap-3 mb-4 rounded-lg bg-muted/30 p-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
              {selectedProduct?.imagePreviewUrl ? (
                <img src={selectedProduct.imagePreviewUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Package className="h-4 w-4 text-muted-foreground/30" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {productLabel}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {typeLabel} · {selectedLength}s · {selectedSize}{talentLabel ? ` · ${talentLabel}` : ""}
                {script.trim() ? " · Script ready" : ""}
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
                Generate Video
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

      {/* RIGHT: result preview / step progress + debug */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="sticky top-6 rounded-xl border border-border bg-card overflow-hidden min-h-[400px] flex items-center justify-center">
          {state.phase === "completed" && state.videoUrl ? (
            <div className="relative w-full">
              <video
                src={state.videoUrl}
                controls
                autoPlay
                loop
                className="w-full"
              />
              <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/60 to-transparent z-10">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  <p className="text-xs text-white font-medium">{productLabel}</p>
                  <button
                    onClick={handleGenerate}
                    className="ml-auto rounded-md bg-white/20 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30 transition-colors"
                  >
                    Re-Generate
                  </button>
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
                  ? "AI prompt generation — typically 30-90 seconds"
                  : isPodcast
                    ? "Video generation — may take longer with multiple reference images (up to 30-60 min)"
                    : "Video generation — typically 2-5 minutes"}
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
              <Video className="h-12 w-12" />
              <p className="text-sm">Your video will appear here</p>
              <p className="text-[11px] text-muted-foreground/30 text-center max-w-xs">
                {productOptional ? "Write your script and click Generate" : "Select a product, write your script, and click Generate"}
              </p>
            </div>
          )}
        </div>

        {/* Debug Panel — Pipeline Prompt Inspector */}
        {(state.phase !== "idle" || Object.values(debugData).some(Boolean)) && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-amber-500/10 transition-colors"
            >
              <Bug className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                Pipeline Debug
              </span>
              {showDebug
                ? <ChevronDown className="h-3.5 w-3.5 text-amber-500/60 ml-auto" />
                : <ChevronRight className="h-3.5 w-3.5 text-amber-500/60 ml-auto" />
              }
            </button>
            {showDebug && (
              <div className="px-4 pb-4 flex flex-col gap-3">
                <DebugStep label="Step 1 — Crafter Agent" content={debugData.crafterPrompt} />
                <DebugStep label="Step 2 — Studio Flow V2" content={debugData.studioFlowPrompt} />
                <DebugStep label="Step 3 — Cleanup" content={debugData.cleanedPrompt} />
                <DebugStep label="Step 4 — Template Format" content={debugData.finalPrompt} />
                {isAroll && <DebugStep label="Step 5 — Voice Cleanup" content={debugData.voiceCleanedPrompt} />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
