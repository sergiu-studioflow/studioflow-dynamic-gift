"use client";

import { useState, useEffect } from "react";
import { Loader2, Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";

type WinnerItem = {
  id: string;
  name: string;
  imageUrl: string;
  previewUrl: string;
  productName: string | null;
  tags: string | null;
};

type WinnersGalleryDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (ref: { id: string; name: string; imageUrl: string; previewUrl: string }) => void;
};

export function WinnersGalleryDialog({ open, onClose, onSelect }: WinnersGalleryDialogProps) {
  const [winners, setWinners] = useState<WinnerItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetch("/api/winners")
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setWinners(data); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open]);

  const handleSelect = (w: WinnerItem) => {
    onSelect({ id: w.id, name: w.name, imageUrl: w.imageUrl, previewUrl: w.previewUrl });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Winners Library</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {winners.length} saved winner{winners.length !== 1 ? "s" : ""} — pick one as your reference
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30" />
            </div>
          ) : winners.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
              <Trophy className="h-8 w-8 mb-2" />
              <p className="text-sm">No winners saved yet</p>
              <p className="text-[10px] mt-1">Save your best ads from the Gallery to build your library</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {winners.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleSelect(w)}
                  className="group relative rounded-xl border border-border bg-card overflow-hidden hover:border-primary/60 hover:shadow-[0_0_12px_rgba(178,255,0,0.1)] transition-all duration-200 text-left"
                >
                  <div className="aspect-[3/4] bg-muted/30 overflow-hidden">
                    <img
                      src={w.previewUrl}
                      alt={w.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="px-2.5 py-2 space-y-1">
                    <p className="text-[10px] font-medium text-foreground truncate">{w.name}</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {w.productName && (
                        <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[8px] text-muted-foreground">
                          {w.productName}
                        </span>
                      )}
                      {w.tags && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] text-primary">
                          {w.tags}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
