"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ImageIcon,
  Plus,
  Trash2,
  Loader2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";

type Scene = {
  id: string;
  name: string;
  imageUrl: string;
  imagePreviewUrl: string;
  description: string | null;
};

function resizeImageForUpload(file: File, maxDim: number, quality: number): Promise<File> {
  return new Promise((resolve) => {
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
          if (blob) resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
          else resolve(file);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

export function ScenesLibrary() {
  const { clientId } = useClient();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addImageUrl, setAddImageUrl] = useState("");
  const [addPreviewUrl, setAddPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    fetch(`/api/scenes?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setScenes(data); })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

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
      const res = await fetch("/api/scenes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (res.ok) {
        setScenes((prev) => prev.filter((s) => !selected.has(s.id)));
        setSelected(new Set());
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    setUploadError("");
    setUploading(true);
    setAddPreviewUrl(URL.createObjectURL(file));

    try {
      const resizedFile = await resizeImageForUpload(file, 2000, 0.85);
      const formData = new FormData();
      formData.append("file", resizedFile);
      // brandSlug resolved server-side via BRAND_SLUG env var
      formData.append("assetType", "video-generation/scenes");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
        throw new Error(err.error || "Upload failed");
      }
      const { url } = await res.json();
      setAddImageUrl(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setAddPreviewUrl("");
      setAddImageUrl("");
    } finally {
      setUploading(false);
    }
  };

  const handleAdd = async () => {
    if (!addName.trim() || !addImageUrl) return;
    setAdding(true);
    try {
      const res = await fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, name: addName.trim(), imageUrl: addImageUrl, description: addDescription.trim() || null }),
      });
      if (res.ok) {
        const created = await res.json();
        setScenes((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setAddName("");
        setAddDescription("");
        setAddImageUrl("");
        setAddPreviewUrl("");
        setShowAdd(false);
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Scenes ({scenes.length})</h2>
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
            onClick={() => setShowAdd(!showAdd)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              showAdd ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}>
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAdd ? "Cancel" : "Upload Scene"}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex gap-4">
            <div className="shrink-0">
              {addPreviewUrl ? (
                <div className="relative group">
                  <img src={addPreviewUrl} alt="Scene" className="h-24 w-32 object-cover rounded-lg border border-border" />
                  <button onClick={() => { setAddImageUrl(""); setAddPreviewUrl(""); }}
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex flex-col items-center justify-center gap-1.5 h-24 w-32 rounded-lg border-2 border-dashed border-border bg-muted/30 hover:border-muted-foreground transition-colors cursor-pointer">
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <UploadIcon className="h-5 w-5 text-muted-foreground" />}
                  <span className="text-[9px] text-muted-foreground font-medium">Studio / Background</span>
                </button>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Scene name"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50" />
              <textarea value={addDescription} onChange={(e) => setAddDescription(e.target.value)}
                placeholder="Description (optional)" rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50" />
              {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
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
      ) : scenes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
          <ImageIcon className="h-12 w-12 mb-3" />
          <p className="text-sm">No scenes yet</p>
          <p className="text-[11px] text-muted-foreground/30">Upload studio or background images to use as references in Podcast mode</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {scenes.map((s) => (
            <div key={s.id}
              onClick={() => toggleSelect(s.id)}
              className={cn(
                "rounded-xl border-2 overflow-hidden transition-all cursor-pointer",
                selected.has(s.id) ? "border-red-500 bg-red-500/5" : "border-border hover:border-primary/40"
              )}>
              <div className="relative aspect-video bg-muted">
                <img src={s.imagePreviewUrl} alt={s.name} className="w-full h-full object-cover" />
                {selected.has(s.id) && (
                  <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center">
                    <div className="h-6 w-6 rounded-full bg-red-500 flex items-center justify-center">
                      <Trash2 className="h-3 w-3 text-white" />
                    </div>
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5">
                <p className="text-[10px] font-medium text-foreground truncate">{s.name}</p>
                {s.description && <p className="text-[9px] text-muted-foreground/60 truncate">{s.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }} />
    </div>
  );
}
