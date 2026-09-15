"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AlertCircle, ImageIcon, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdCard, type StaticAdGeneration } from "./ad-card";
import { AdDetailDialog } from "./ad-detail-dialog";
import { useClient } from "@/lib/client-context";
import { QC_FILTERS, useQcAutoGrade } from "@/components/qc/review-scorecard";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { downloadGeneratedAsset } from "@/lib/static-ads/download-client";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "generating", label: "Generating" },
  { value: "error", label: "Error" },
];

type AdGalleryProps = {
  refreshTrigger?: number;
};

/**
 * The gallery API re-signs every image URL on each fetch, and a new URL makes the browser
 * re-download the image. The grid refreshes every few seconds while ads render or grade, so
 * a URL is reused for the same object while it is comfortably inside its 10-minute validity.
 */
const SIGNED_URL_REUSE_MS = 5 * 60 * 1000;

export function AdGallery({ refreshTrigger }: AdGalleryProps) {
  const [generations, setGenerations] = useState<StaticAdGeneration[]>([]);
  const [filter, setFilter] = useState("all");
  const [qcFilter, setQcFilter] = useState<string>("default");
  const [loading, setLoading] = useState(true);
  const [selectedGeneration, setSelectedGeneration] = useState<StaticAdGeneration | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inFlightCount, setInFlightCount] = useState(0);
  const signedUrlsRef = useRef(new Map<string, { url: string; signedAt: number }>());
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
      if (Array.isArray(data)) {
        const now = Date.now();
        const stable = (signed: string | null): string | null => {
          if (!signed) return signed;
          const objectUrl = signed.split("?")[0];
          const cached = signedUrlsRef.current.get(objectUrl);
          if (cached && now - cached.signedAt < SIGNED_URL_REUSE_MS) return cached.url;
          signedUrlsRef.current.set(objectUrl, { url: signed, signedAt: now });
          return signed;
        };
        setGenerations(
          (data as StaticAdGeneration[]).map((g) => ({
            ...g,
            imageUrl: stable(g.imageUrl),
            thumbnailUrl: stable(g.thumbnailUrl),
          }))
        );
      }
      setInFlightCount(Number(res.headers.get("x-in-flight-count") || 0));
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

  // Auto-refresh while there are generating items — including ads still rendering that the
  // default view hides. Each refresh runs the server sweep that moves their chain forward.
  useEffect(() => {
    const hasGenerating =
      inFlightCount > 0 || generations.some((g) => g.status === "generating" || g.status === "pending");
    if (!hasGenerating) return;

    const interval = setInterval(fetchGallery, 5000);
    return () => clearInterval(interval);
  }, [generations, inFlightCount, fetchGallery]);

  // Delete asks first: it is permanent and removes the image file too.
  const handleDelete = (id: string) => {
    setActionError(null);
    setPendingDeleteId(id);
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/static-ads/gallery/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setActionError(data?.error || `Delete failed (${res.status})`);
        return;
      }
      setGenerations((prev) => prev.filter((g) => g.id !== id));
      setDialogOpen(false);
      setSelectedGeneration(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const handleDownload = async (gen: StaticAdGeneration) => {
    if (!gen.imageUrl) return;
    setActionError(null);
    const filename = `${gen.styleName || "ad"}-${gen.productName || "product"}-${gen.id.slice(0, 8)}.png`;
    try {
      await downloadGeneratedAsset(gen.imageUrl, filename);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Download failed");
    }
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

      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="flex-1 text-xs text-red-500">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-red-400 hover:bg-red-500/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
                setActionError(null);
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
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setActionError(null); }}
        onDelete={handleDelete}
        errorMessage={actionError}
      />

      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDeleteId(null); }}
        onConfirm={confirmDelete}
        count={1}
        resourceName="ad"
        loading={deleting}
      />
    </div>
  );
}
