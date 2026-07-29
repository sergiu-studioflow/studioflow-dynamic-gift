"use client";

import { useState } from "react";
import { ImageIcon, Loader2, AlertCircle, Download, Trash2, Trophy, CheckCircle2, Layers, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";
import { SendToQueueButton } from "@/components/posting/send-to-queue-button";
import { QcBadge } from "@/components/qc/review-scorecard";

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
  mode?: string | null;
  batchId?: string | null;
  batchSize?: number | null;
  batchIndex?: number | null;
  sourceGenerationId?: string | null;
  qcStatus?: string | null;
  qcReviewId?: string | null;
};

/** Client-side mirror of src/lib/qc/gate.ts isShippable — keep the two in sync. */
export function qcShippable(qcStatus?: string | null): boolean {
  return ["approved", "skipped"].includes(qcStatus ?? "skipped");
}

type AdCardProps = {
  generation: StaticAdGeneration;
  onClick: () => void;
  onDownload?: (generation: StaticAdGeneration) => void;
  onDelete?: (id: string) => void;
};

export function AdCard({ generation, onClick, onDownload, onDelete }: AdCardProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const imgUrl = generation.thumbnailUrl || generation.imageUrl;
  const isBatch = !!generation.batchId && (generation.batchSize ?? 1) > 1;
  const batchSize = generation.batchSize ?? 1;
  const isRefined = generation.mode === "refined";
  // A creative the gate is holding must not offer Download / Winners / Schedule — the
  // routes 403 anyway, so showing the buttons would only produce a confusing error.
  const shippable = qcShippable(generation.qcStatus);

  // Hide cards whose preview URL is unreachable (legacy cross-client R2 paths,
  // expired tempfiles, etc). The server-side filter catches most; this is the
  // belt-and-suspenders for ones that slip through.
  if (imageBroken) return null;

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
    <div className={cn("relative", isBatch && "pt-2 pr-2")}>
      {/* Stacked card shadows behind the main card to suggest a batch */}
      {isBatch && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 translate-x-1.5 -translate-y-1.5 rounded-xl border border-border bg-card/60"
          />
          <div
            aria-hidden
            className="absolute inset-0 translate-x-3 -translate-y-3 rounded-xl border border-border bg-card/30"
          />
        </>
      )}
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
            onError={() => setImageBroken(true)}
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
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <StatusBadge status={generation.status} />
          <QcBadge qcStatus={generation.qcStatus} />
        </div>

        {/* Batch chip — shows aspect-ratio when all siblings share one (the
            new auto-refinement flow always does), else falls back to a count. */}
        {isBatch && (
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/55 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-white">
            <Layers className="h-3 w-3" />
            {batchSize} {generation.aspectRatio && generation.aspectRatio !== "auto" ? `in ${generation.aspectRatio}` : "variations"}
          </div>
        )}

        {/* Refined chip — product-consistent final ad (GPT Image 2 image-to-image). */}
        {isRefined && !isBatch && (
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-primary/85 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            <Wand2 className="h-3 w-3" />
            Refined
          </div>
        )}
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
          {generation.status === "completed" && generation.imageUrl && shippable && (
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
          {generation.status === "completed" && generation.imageUrl && shippable && onDownload && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(generation); }}
              className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Download className="h-3 w-3" />
              Download
            </button>
          )}
          {generation.status === "completed" && generation.imageUrl && shippable && (
            <span onClick={(e) => e.stopPropagation()}>
              <SendToQueueButton
                sourceType="static_ad"
                sourceId={generation.id}
                label="Schedule"
                className="px-2 py-1 text-[11px]"
              />
            </span>
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
    </div>
  );
}
