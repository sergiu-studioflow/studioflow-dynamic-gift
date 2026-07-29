"use client";

import { useState, useEffect, useCallback } from "react";
import { Video, Loader2, Clock, RectangleHorizontal } from "lucide-react";
import { useClient } from "@/lib/client-context";
import { cn } from "@/lib/utils";
import { QcBadge, QcReviewPanel, QC_FILTERS, useQcAutoGrade } from "@/components/qc/review-scorecard";

type VideoGeneration = {
  id: string;
  productName: string | null;
  videoType: string;
  duration: number;
  aspectRatio: string;
  script: string | null;
  videoUrl: string | null;
  videoPreviewUrl: string | null;
  createdAt: string;
  qcStatus?: string | null;
  qcReviewId?: string | null;
};

export function VideoGallery({ refreshTrigger }: { refreshTrigger: number }) {
  const { clientId } = useClient();
  const [videos, setVideos] = useState<VideoGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [qcFilter, setQcFilter] = useState<string>("default");
  const [reportFor, setReportFor] = useState<string | null>(null);

  const fetchVideos = useCallback(
    (showSpinner: boolean) => {
      if (!clientId) return;
      if (showSpinner) setLoading(true);
      const qs = qcFilter !== "default" ? `&qc=${qcFilter}` : "";
      // Sweep first to catch any completed generations that weren't polled
      fetch("/api/video-generation/sweep")
        .catch(() => {}) // non-critical
        .finally(() => {
          fetch(`/api/video-generation/gallery?clientId=${clientId}${qs}`)
            .then((r) => r.json())
            .then((data) => {
              if (Array.isArray(data)) setVideos(data);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
        });
    },
    [clientId, qcFilter]
  );

  useEffect(() => {
    fetchVideos(true);
  }, [refreshTrigger, fetchVideos]);

  // Drive QC grading while any clip is still awaiting a verdict.
  useQcAutoGrade(
    videos.some((v) => v.qcStatus === "pending"),
    () => fetchVideos(false)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
        <Video className="h-12 w-12 mb-3" />
        <p className="text-sm">No videos generated yet</p>
        <p className="text-[11px] text-muted-foreground/30">
          Generate your first video in the Create tab
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        {QC_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setQcFilter(value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              qcFilter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {videos.map((v) => (
        <div
          key={v.id}
          className="rounded-xl border border-border bg-card overflow-hidden group"
        >
          {/* Video preview */}
          <div className="relative aspect-[9/16] bg-muted">
            {v.qcStatus ? (
              <div className="absolute top-2 right-2 z-10">
                <QcBadge qcStatus={v.qcStatus} />
              </div>
            ) : null}
            {playingId === v.id ? (
              <video
                src={v.videoPreviewUrl || v.videoUrl || ""}
                controls
                autoPlay
                className="w-full h-full object-cover"
              />
            ) : (
              <button
                onClick={() => setPlayingId(v.id)}
                className="w-full h-full flex items-center justify-center hover:bg-muted/80 transition-colors"
              >
                {v.videoPreviewUrl || v.videoUrl ? (
                  <>
                    <video
                      src={v.videoPreviewUrl || v.videoUrl || ""}
                      muted
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
                        <div className="ml-0.5 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[10px] border-l-black" />
                      </div>
                    </div>
                  </>
                ) : (
                  <Video className="h-8 w-8 text-muted-foreground/30" />
                )}
              </button>
            )}
          </div>

          {/* Info */}
          <div className="px-3 py-2.5 border-t border-border">
            <p className="text-xs font-medium text-foreground truncate">
              {v.productName || "Unknown product"}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {v.duration}s
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <RectangleHorizontal className="h-3 w-3" />
                {v.aspectRatio}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase">
                {v.videoType}
              </span>
            </div>
            {v.script && (
              <p className="mt-1.5 text-[10px] text-muted-foreground/60 line-clamp-2">
                {v.script}
              </p>
            )}
            {v.qcReviewId && v.qcStatus && v.qcStatus !== "skipped" ? (
              <>
                <button
                  onClick={() => setReportFor(reportFor === v.id ? null : v.id)}
                  className="mt-2 text-[10px] font-medium text-primary hover:underline"
                >
                  {reportFor === v.id ? "Hide QC report" : "View QC report"}
                </button>
                {reportFor === v.id ? (
                  <div className="mt-2">
                    <QcReviewPanel reviewId={v.qcReviewId} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}
