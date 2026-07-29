"use client";

import { useState, useEffect, useCallback } from "react";
import { ImageIcon, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdCard, type StaticAdGeneration } from "./ad-card";
import { AdDetailDialog } from "./ad-detail-dialog";
import { useClient } from "@/lib/client-context";
import { QC_FILTERS, useQcAutoGrade } from "@/components/qc/review-scorecard";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "generating", label: "Generating" },
  { value: "error", label: "Error" },
];

type AdGalleryProps = {
  refreshTrigger?: number;
};

export function AdGallery({ refreshTrigger }: AdGalleryProps) {
  const [generations, setGenerations] = useState<StaticAdGeneration[]>([]);
  const [filter, setFilter] = useState("all");
  const [qcFilter, setQcFilter] = useState<string>("default");
  const [loading, setLoading] = useState(true);
  const [selectedGeneration, setSelectedGeneration] = useState<StaticAdGeneration | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { clientId } = useClient();

  const fetchGallery = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (clientId) params.set("clientId", clientId);
      if (qcFilter !== "default") params.set("qc", qcFilter);
      params.set("groupByBatch", "true");
      const url = `/api/static-ads/gallery?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();
      if (Array.isArray(data)) setGenerations(data);
    } catch (err) {
      console.error("[gallery] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, qcFilter, clientId]);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery, refreshTrigger]);

  // Drive QC grading while any completed ad is still awaiting a verdict, so the badge
  // and the Download / Winners / Schedule buttons settle within seconds.
  useQcAutoGrade(
    generations.some((g) => g.status === "completed" && g.qcStatus === "pending"),
    fetchGallery
  );

  // Auto-refresh while there are generating items
  useEffect(() => {
    const hasGenerating = generations.some((g) => g.status === "generating" || g.status === "pending");
    if (!hasGenerating) return;

    const interval = setInterval(fetchGallery, 5000);
    return () => clearInterval(interval);
  }, [generations, fetchGallery]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/static-ads/gallery/${id}`, { method: "DELETE" });
      setGenerations((prev) => prev.filter((g) => g.id !== id));
      setDialogOpen(false);
      setSelectedGeneration(null);
    } catch (err) {
      console.error("[gallery] delete error:", err);
    }
  };

  const handleDownload = (gen: StaticAdGeneration) => {
    if (!gen.imageUrl) return;
    const filename = `${gen.styleName || "ad"}-${gen.productName || "product"}-${gen.id.slice(0, 8)}.png`;
    const proxyUrl = `/api/static-ads/download?url=${encodeURIComponent(gen.imageUrl)}&filename=${encodeURIComponent(filename)}`;
    window.open(proxyUrl, "_blank");
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                filter === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {label}
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-border" />
          {QC_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setQcFilter(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                qcFilter === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setLoading(true); fetchGallery(); }}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Grid */}
      {generations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <ImageIcon className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">
            {filter === "all" ? "No ads generated yet." : `No ${filter} ads.`}
          </p>
          <p className="text-xs mt-1 opacity-60">
            Go to the Create tab to generate your first ad.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {generations.map((gen) => (
            <AdCard
              key={gen.id}
              generation={gen}
              onClick={() => {
                setSelectedGeneration(gen);
                setDialogOpen(true);
              }}
              onDownload={handleDownload}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <AdDetailDialog
        generation={selectedGeneration}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDelete={handleDelete}
      />
    </div>
  );
}
