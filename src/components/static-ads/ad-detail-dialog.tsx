"use client";

import { Download, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import type { StaticAdGeneration } from "./ad-card";

type AdDetailDialogProps = {
  generation: StaticAdGeneration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete?: (id: string) => void;
};

export function AdDetailDialog({ generation, open, onOpenChange, onDelete }: AdDetailDialogProps) {
  if (!generation) return null;

  const handleDownload = () => {
    if (!generation.imageUrl) return;
    const filename = `${generation.styleName || "ad"}-${generation.productName || "product"}-${generation.id.slice(0, 8)}.png`;
    const proxyUrl = `/api/static-ads/download?url=${encodeURIComponent(generation.imageUrl)}&filename=${encodeURIComponent(filename)}`;
    window.open(proxyUrl, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{generation.styleName || "Generated Ad"}</DialogTitle>
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
            <span className="text-xs text-muted-foreground">
              {generation.aspectRatio}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {generation.status === "completed" && generation.imageUrl && (
              <button
                onClick={handleDownload}
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

        {/* Error message */}
        {generation.errorMessage && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs text-red-400">{generation.errorMessage}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
