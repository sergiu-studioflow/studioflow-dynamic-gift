"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Trash2, Trophy, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { QcBadge, QcReviewPanel } from "@/components/qc/review-scorecard";
import { qcShippable } from "./ad-card";
import type { StaticAdGeneration } from "./ad-card";

type AdDetailDialogProps = {
  generation: StaticAdGeneration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => void;
};

type Variation = StaticAdGeneration & {
  finalPrompt?: string | null;
};

export function AdDetailDialog({ generation, open, onOpenChange, onDelete }: AdDetailDialogProps) {
  const isBatch = !!generation?.batchId && (generation?.batchSize ?? 1) > 1;
  const [variations, setVariations] = useState<Variation[] | null>(null);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSavedIds(new Set());
    setSavingIds(new Set());

    if (!isBatch || !generation?.batchId) {
      setVariations(null);
      return;
    }

    let cancelled = false;
    setLoadingBatch(true);
    fetch(`/api/static-ads/batch/${generation.batchId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.variations)) {
          setVariations(data.variations);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingBatch(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, isBatch, generation?.batchId]);

  if (!generation) return null;

  const handleDownload = (g: { id: string; imageUrl: string | null; styleName: string | null; productName: string | null }) => {
    if (!g.imageUrl) return;
    const filename = `${g.styleName || "ad"}-${g.productName || "product"}-${g.id.slice(0, 8)}.png`;
    const proxyUrl = `/api/static-ads/download?url=${encodeURIComponent(g.imageUrl)}&filename=${encodeURIComponent(filename)}`;
    window.open(proxyUrl, "_blank");
  };

  const handleSaveWinner = async (id: string) => {
    if (savedIds.has(id) || savingIds.has(id)) return;
    setSavingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch("/api/winners/save-from-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: id }),
      });
      if (res.ok) setSavedIds((prev) => new Set(prev).add(id));
    } catch { /* ignore */ }
    finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(isBatch ? "max-w-5xl" : "max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>
            {isBatch
              ? `${generation.batchSize ?? variations?.length ?? 0} variations · ${generation.productName || "Generated Ad"}`
              : generation.styleName || "Generated Ad"}
          </DialogTitle>
          <DialogDescription>
            {generation.productName} &middot;{" "}
            {new Date(generation.createdAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </DialogDescription>
        </DialogHeader>

        {isBatch ? (
          loadingBatch && !variations ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
            </div>
          ) : variations && variations.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto pr-1">
              {variations.map((v) => (
                <VariationItem
                  key={v.id}
                  variation={v}
                  isSaved={savedIds.has(v.id)}
                  isSaving={savingIds.has(v.id)}
                  onSaveWinner={() => handleSaveWinner(v.id)}
                  onDownload={() => handleDownload(v)}
                  onDelete={onDelete ? () => onDelete(v.id) : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No variations found.</p>
          )
        ) : (
          <>
            {/* Image */}
            {generation.imageUrl && (
              <div className="relative overflow-hidden rounded-xl border border-border">
                <img
                  src={generation.imageUrl}
                  alt={`${generation.styleName} - ${generation.productName}`}
                  className="w-full"
                />
              </div>
            )}

            {/* Metadata */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <StatusBadge status={generation.status} />
                <QcBadge qcStatus={generation.qcStatus} />
                <span className="text-xs text-muted-foreground">{generation.aspectRatio}</span>
              </div>

              <div className="flex items-center gap-2">
                {generation.status === "completed" && generation.imageUrl && qcShippable(generation.qcStatus) && (
                  <button
                    onClick={() => handleDownload(generation)}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(generation.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-500 transition-all hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* Quality Control report */}
            {generation.qcReviewId && generation.qcStatus !== "skipped" ? (
              <QcReviewPanel reviewId={generation.qcReviewId} />
            ) : null}

            {/* Error message */}
            {generation.errorMessage && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-xs text-red-400">{generation.errorMessage}</p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type VariationItemProps = {
  variation: Variation;
  isSaved: boolean;
  isSaving: boolean;
  onSaveWinner: () => void;
  onDownload: () => void;
  onDelete?: () => void;
};

function VariationItem({
  variation,
  isSaved,
  isSaving,
  onSaveWinner,
  onDownload,
  onDelete,
}: VariationItemProps) {
  const imgUrl = variation.thumbnailUrl || variation.imageUrl;
  const total = variation.batchSize ?? 1;
  const index = variation.batchIndex ?? 1;

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {variation.status === "completed" && imgUrl ? (
          <img src={imgUrl} alt={`Variation ${index}`} className="h-full w-full object-cover" />
        ) : variation.status === "error" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-red-500">
            <AlertCircle className="h-6 w-6" />
            <p className="text-[11px] text-center line-clamp-3">
              {variation.errorMessage || "Failed"}
            </p>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-[11px]">Generating…</p>
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-md bg-black/55 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-white">
          {index}/{total}
        </span>
        <div className="absolute top-2 right-2">
          <StatusBadge status={variation.status} />
        </div>
      </div>

      <div className="p-2 flex items-center gap-1.5 flex-wrap">
        {variation.status === "completed" && variation.imageUrl && (
          <button
            onClick={onSaveWinner}
            disabled={isSaving || isSaved}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              isSaved
                ? "bg-primary/10 text-primary cursor-default"
                : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
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
        )}
        {variation.status === "completed" && variation.imageUrl && (
          <button
            onClick={onDownload}
            className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
