"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Plus, Trash2, Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Winner = {
  id: string;
  name: string;
  imageUrl: string;
  previewUrl: string;
  productName: string | null;
  tags: string | null;
  createdAt: string;
};

export function WinnersLibraryManager() {
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchWinners = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/winners");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setWinners(data);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWinners(); }, [fetchWinners]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
      const res = await fetch("/api/winners", { method: "POST", body: formData });
      if (res.ok) await fetchWinners();
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }, [fetchWinners]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/winners/${id}`, { method: "DELETE" });
      if (res.ok) setWinners((prev) => prev.filter((w) => w.id !== id));
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  }, []);

  return (
    <div>
      {/* Header with upload button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">
          {winners.length} winner{winners.length !== 1 ? "s" : ""} saved
        </p>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Upload Winner
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
        </div>
      ) : winners.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground/40">
          <Trophy className="h-8 w-8 mb-2" />
          <p className="text-xs">No winners yet</p>
          <p className="text-[10px] mt-1">Save your best ads from the Gallery or upload them here</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {winners.map((w) => (
            <div
              key={w.id}
              className="group relative rounded-xl border border-border bg-card overflow-hidden"
            >
              <div className="aspect-[4/5] bg-muted/30 overflow-hidden">
                <img
                  src={w.previewUrl}
                  alt={w.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="px-2 py-1.5">
                <p className="text-[9px] font-medium text-foreground truncate">{w.name}</p>
                {w.productName && (
                  <p className="text-[8px] text-muted-foreground truncate">{w.productName}</p>
                )}
              </div>

              {/* Delete button on hover */}
              <button
                onClick={() => handleDelete(w.id)}
                disabled={deletingId === w.id}
                className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                {deletingId === w.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
