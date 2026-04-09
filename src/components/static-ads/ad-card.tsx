"use client";

import { useState } from "react";
import { ImageIcon, Loader2, AlertCircle, Download, Trash2, Trophy, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";

export type StaticAdGeneration = {
  id: string;
  styleName: string | null;
  productName: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  status: string;
  aspectRatio: string;
  errorMessage: string | null;
  createdAt: string;
};

type AdCardProps = {
  generation: StaticAdGeneration;
  onClick: () => void;
  onDownload?: (generation: StaticAdGeneration) => void;
  onDelete?: (id: string) => void;
};

export function AdCard({ generation, onClick, onDownload, onDelete }: AdCardProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const imgUrl = generation.thumbnailUrl || generation.imageUrl;

  const handleSaveToWinners = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    try {
      const res = await fetch("/api/winners/save-from-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: generation.id }),
      });
      if (res.ok) setSaved(true);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-md text-left"
    >
      {/* Image area — clickable for detail view */}
      <button onClick={onClick} className="relative aspect-square w-full overflow-hidden bg-muted">
        {generation.status === "completed" && imgUrl ? (
          <img
            src={imgUrl}
            alt={`${generation.styleName} - ${generation.productName}`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : generation.status === "generating" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
            <p className="text-[11px] text-muted-foreground">Generating...</p>
          </div>
        ) : generation.status === "error" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <AlertCircle className="h-8 w-8 text-red-500/50" />
            <p className="text-[11px] text-red-400">Failed</p>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}

        {/* Status badge overlay */}
        <div className="absolute top-2 right-2">
          <StatusBadge status={generation.status} />
        </div>
      </button>

      {/* Info + actions */}
      <div className="p-3 space-y-2">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-foreground truncate">
            {generation.styleName || "Unknown Style"}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {generation.productName || "Unknown Product"}
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            {new Date(generation.createdAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {generation.status === "completed" && generation.imageUrl && (
            <button
              onClick={handleSaveToWinners}
              disabled={saving || saved}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                saved
                  ? "bg-primary/10 text-primary cursor-default"
                  : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
              )}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <CheckCircle2 className="h-3 w-3" /> : <Trophy className="h-3 w-3" />}
              {saved ? "Winner!" : "Winner"}
            </button>
          )}
          {generation.status === "completed" && generation.imageUrl && onDownload && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(generation); }}
              className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Download className="h-3 w-3" />
              Download
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(generation.id); }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
