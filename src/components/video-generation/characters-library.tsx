"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users,
  Plus,
  Trash2,
  Loader2,
  Upload as UploadIcon,
  X,
  Sparkles,
  Eye,
  Copy,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";
import { StepProgress, type Step } from "@/components/static-ads/step-progress";

type Character = {
  id: string;
  name: string;
  imageUrl: string;
  imagePreviewUrl: string;
  description: string | null;
  status: string;
};

type GenerateState =
  | { phase: "idle" }
  | { phase: "pipeline"; currentStep: number }
  | { phase: "generating"; characterId: string }
  | { phase: "completed"; characterId: string }
  | { phase: "error"; message: string };

function buildGenerateSteps(currentStep: number): Step[] {
  const labels = ["Analyzing likeness...", "Applying realism filter...", "Generating image..."];
  return labels.map((label, i) => {
    if (i < currentStep) return { label, status: "complete" as const };
    if (i === currentStep) return { label, status: "active" as const };
    return { label, status: "pending" as const };
  });
}

/**
 * Resize an image client-side to stay under Vercel's 4.5MB body limit.
 * Uses canvas to downscale and compress to JPEG.
 */
function resizeImageForUpload(file: File, maxDim: number, quality: number): Promise<File> {
  return new Promise((resolve) => {
    // If already small enough, return as-is
    if (file.size < 3_500_000) { resolve(file); return; }

    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

export function CharactersLibrary() {
  const { clientId } = useClient();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Manual add form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addImageUrl, setAddImageUrl] = useState("");
  const [addPreviewUrl, setAddPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);

  // AI generate form
  const [showGenerate, setShowGenerate] = useState(false);
  const [genName, setGenName] = useState("");
  const [genMode, setGenMode] = useState<"likeness" | "identical">("likeness");
  const [genSourceUrl, setGenSourceUrl] = useState("");
  const [genSourcePreview, setGenSourcePreview] = useState("");
  const [genUploading, setGenUploading] = useState(false);
  const [genState, setGenState] = useState<GenerateState>({ phase: "idle" });

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    fetch(`/api/characters?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCharacters(data); })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // Poll for generating characters
  useEffect(() => {
    if (genState.phase !== "generating") return;
    const { characterId } = genState;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/characters/generate/${characterId}`);
        const data = await res.json();

        if (data.status === "ready") {
          setGenState({ phase: "completed", characterId });
          load();
        } else if (data.status === "error") {
          setGenState({ phase: "error", message: data.errorMessage || "Generation failed" });
        }
      } catch { /* transient */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [genState, load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/characters", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (res.ok) {
        setCharacters((prev) => prev.filter((c) => !selected.has(c.id)));
        setSelected(new Set());
      }
    } finally {
      setDeleting(false);
    }
  };

  const [uploadError, setUploadError] = useState("");

  const handleImageUpload = async (file: File, target: "add" | "gen") => {
    setUploadError("");
    // Accept any image — don't block on mime type (HEIC/HEIF may not match)
    const setUploadState = target === "add" ? setUploading : setGenUploading;
    setUploadState(true);

    // Show preview immediately from local file
    const preview = URL.createObjectURL(file);
    if (target === "add") setAddPreviewUrl(preview);
    else setGenSourcePreview(preview);

    try {
      // Resize client-side to stay under Vercel's 4.5MB body limit
      const resizedFile = await resizeImageForUpload(file, 2000, 0.85);

      const formData = new FormData();
      formData.append("file", resizedFile);
      // brandSlug resolved server-side via BRAND_SLUG env var
      formData.append("assetType", "video-generation/characters");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
        throw new Error(err.error || "Upload failed");
      }
      const { url } = await res.json();
      if (target === "add") setAddImageUrl(url);
      else setGenSourceUrl(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      // Clear preview on error
      if (target === "add") { setAddPreviewUrl(""); setAddImageUrl(""); }
      else { setGenSourcePreview(""); setGenSourceUrl(""); }
    } finally {
      setUploadState(false);
    }
  };

  const addFileRef = useRef<HTMLInputElement>(null);
  const genFileRef = useRef<HTMLInputElement>(null);

  const handleAdd = async () => {
    if (!addName.trim() || !addImageUrl) return;
    setAdding(true);
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, name: addName.trim(), imageUrl: addImageUrl, description: addDescription.trim() || null }),
      });
      if (res.ok) {
        const created = await res.json();
        setCharacters((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setAddName(""); setAddDescription(""); setAddImageUrl(""); setAddPreviewUrl(""); setShowAdd(false);
      }
    } finally { setAdding(false); }
  };

  const handleGenerate = async () => {
    if (!genName.trim() || !genSourceUrl) return;

    setGenState({ phase: "pipeline", currentStep: 0 });

    // Simulate step progression while the API runs
    const timer1 = setTimeout(() => setGenState((s) => s.phase === "pipeline" ? { phase: "pipeline", currentStep: 1 } : s), 8000);
    const timer2 = setTimeout(() => setGenState((s) => s.phase === "pipeline" ? { phase: "pipeline", currentStep: 2 } : s), 20000);

    try {
      const res = await fetch("/api/characters/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, sourceImageUrl: genSourceUrl, name: genName.trim(), mode: genMode }),
      });

      clearTimeout(timer1); clearTimeout(timer2);

      const data = await res.json();

      if (!res.ok || data.error) {
        setGenState({ phase: "error", message: data.error || "Generation failed" });
        return;
      }

      setGenState({ phase: "generating", characterId: data.characterId });
      load(); // Refresh to show the generating character
    } catch (err) {
      clearTimeout(timer1); clearTimeout(timer2);
      setGenState({ phase: "error", message: err instanceof Error ? err.message : "Network error" });
    }
  };

  const resetGenerate = () => {
    setGenState({ phase: "idle" });
    setGenName(""); setGenSourceUrl(""); setGenSourcePreview(""); setGenMode("likeness");
    setShowGenerate(false);
  };

  const isGenerating = genState.phase === "pipeline" || genState.phase === "generating";

  const genSteps: Step[] =
    genState.phase === "pipeline" ? buildGenerateSteps(genState.currentStep)
    : genState.phase === "generating" ? buildGenerateSteps(2)
    : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Characters ({characters.filter(c => c.status === "ready").length})</h2>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20 transition-colors">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete {selected.size}
            </button>
          )}
          <button
            onClick={() => { setShowGenerate(!showGenerate); if (showAdd) setShowAdd(false); }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              showGenerate ? "border-primary bg-primary/10 text-primary" : "border-primary/30 text-primary hover:bg-primary/10"
            )}>
            {showGenerate ? <X className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {showGenerate ? "Cancel" : "Create New Character"}
          </button>
          <button
            onClick={() => { setShowAdd(!showAdd); if (showGenerate) setShowGenerate(false); }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              showAdd ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}>
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAdd ? "Cancel" : "Upload Character"}
          </button>
        </div>
      </div>

      {/* AI Generate form */}
      {showGenerate && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">Create New Character from Photo</h3>
          </div>

          {genState.phase === "idle" || genState.phase === "error" ? (
            <>
              <div className="flex gap-4">
                {/* Source image upload */}
                <div className="shrink-0">
                  {genSourcePreview ? (
                    <div className="relative group">
                      <img src={genSourcePreview} alt="Source" className="h-36 w-24 object-cover rounded-lg border border-border" />
                      <button onClick={() => { setGenSourceUrl(""); setGenSourcePreview(""); }}
                        className="absolute top-1 right-1 p-0.5 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => genFileRef.current?.click()} disabled={genUploading}
                      className="flex flex-col items-center justify-center gap-1.5 h-36 w-24 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:border-primary/50 transition-colors cursor-pointer">
                      {genUploading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <UploadIcon className="h-5 w-5 text-primary" />}
                      <span className="text-[9px] text-primary font-medium">Upload Photo</span>
                    </button>
                  )}
                </div>

                {/* Name + Mode */}
                <div className="flex-1 space-y-3">
                  <input value={genName} onChange={(e) => setGenName(e.target.value)}
                    placeholder="Character name"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50" />

                  {/* Mode toggle */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Generation Mode</label>
                    <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
                      {([
                        { mode: "likeness" as const, icon: Eye, label: "Likeness", desc: "Inspired by the photo" },
                        { mode: "identical" as const, icon: Copy, label: "Identical", desc: "Exact match attempt" },
                      ]).map(({ mode, icon: Icon, label, desc }) => (
                        <button key={mode} onClick={() => setGenMode(mode)}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all",
                            genMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}>
                          <Icon className="h-3.5 w-3.5" />
                          <div className="text-left">
                            <div>{label}</div>
                            <div className="text-[9px] font-normal text-muted-foreground">{desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button onClick={handleGenerate} disabled={!genName.trim() || !genSourceUrl}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-semibold transition-all",
                      genName.trim() && genSourceUrl
                        ? "bg-primary text-primary-foreground hover:brightness-110 shadow-[0_0_15px_rgba(178,255,0,0.15)]"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}>
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate Character
                  </button>
                </div>
              </div>

              {genState.phase === "error" && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-red-500">{genState.message}</p>
                    <button onClick={() => setGenState({ phase: "idle" })} className="mt-1 text-[11px] text-red-400 hover:underline">Try again</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="rounded-2xl border border-border bg-muted/20 p-5 w-full max-w-xs">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Generation Progress</p>
                <StepProgress steps={genSteps} />
              </div>
              <p className="text-[11px] text-muted-foreground/60 text-center">
                {genState.phase === "pipeline" ? "AI analysis — typically 20-40 seconds" : "Image generation — typically 30-60 seconds"}
              </p>
              {genState.phase === "completed" && (
                <button onClick={resetGenerate}
                  className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold">
                  Done
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual add form */}
      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex gap-4">
            <div className="shrink-0">
              {addPreviewUrl ? (
                <div className="relative group">
                  <img src={addPreviewUrl} alt="Character" className="h-32 w-20 object-cover rounded-lg border border-border" />
                  <button onClick={() => { setAddImageUrl(""); setAddPreviewUrl(""); }}
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button onClick={() => addFileRef.current?.click()} disabled={uploading}
                  className="flex flex-col items-center justify-center gap-1.5 h-32 w-20 rounded-lg border-2 border-dashed border-border bg-muted/30 hover:border-muted-foreground transition-colors cursor-pointer">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <UploadIcon className="h-5 w-5 text-muted-foreground" />}
                  <span className="text-[9px] text-muted-foreground font-medium">9:16</span>
                </button>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Character name"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50" />
              <textarea value={addDescription} onChange={(e) => setAddDescription(e.target.value)}
                placeholder="Description (optional)" rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50" />
              {uploadError && (
                <p className="text-xs text-red-500">{uploadError}</p>
              )}
              <button onClick={handleAdd} disabled={!addName.trim() || !addImageUrl || adding}
                className={cn("flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
                  addName.trim() && addImageUrl ? "bg-primary text-primary-foreground hover:brightness-110" : "bg-muted text-muted-foreground cursor-not-allowed")}>
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {adding ? "Adding..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
          <Users className="h-12 w-12 mb-3" />
          <p className="text-sm">No characters yet</p>
          <p className="text-[11px] text-muted-foreground/30">Create an AI character from a photo or upload one directly</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {characters.map((c) => (
            <div key={c.id}
              onClick={() => c.status === "ready" && toggleSelect(c.id)}
              className={cn(
                "rounded-xl border-2 overflow-hidden transition-all group",
                c.status === "generating" ? "border-primary/30 opacity-70" :
                selected.has(c.id) ? "border-red-500 bg-red-500/5 cursor-pointer" :
                "border-border hover:border-primary/40 cursor-pointer"
              )}>
              <div className="relative aspect-[9/16] bg-muted">
                <img src={c.imagePreviewUrl} alt={c.name} className="w-full h-full object-cover" />
                {c.status === "generating" && (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
                {c.status === "error" && (
                  <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center">
                    <AlertCircle className="h-6 w-6 text-red-500" />
                  </div>
                )}
                {selected.has(c.id) && (
                  <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center">
                    <div className="h-6 w-6 rounded-full bg-red-500 flex items-center justify-center">
                      <Trash2 className="h-3 w-3 text-white" />
                    </div>
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5">
                <p className="text-[10px] font-medium text-foreground truncate">{c.name}</p>
                {c.status === "generating" && <p className="text-[9px] text-primary truncate">Generating...</p>}
                {c.status === "error" && <p className="text-[9px] text-red-500 truncate">Error</p>}
                {c.status === "ready" && c.description && <p className="text-[9px] text-muted-foreground/60 truncate">{c.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={addFileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, "add"); e.target.value = ""; }} />
      <input ref={genFileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, "gen"); e.target.value = ""; }} />
    </div>
  );
}
