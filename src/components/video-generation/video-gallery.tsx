"use client";

import { useState, useEffect } from "react";
import { Video, Loader2, Clock, RectangleHorizontal } from "lucide-react";
import { useClient } from "@/lib/client-context";

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
};

export function VideoGallery({ refreshTrigger }: { refreshTrigger: number }) {
  const { clientId } = useClient();
  const [videos, setVideos] = useState<VideoGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    // Sweep first to catch any completed generations that weren't polled
    fetch("/api/video-generation/sweep")
      .catch(() => {}) // non-critical
      .finally(() => {
        fetch(`/api/video-generation/gallery?clientId=${clientId}`)
          .then((r) => r.json())
          .then((data) => {
            if (Array.isArray(data)) setVideos(data);
          })
          .catch(console.error)
          .finally(() => setLoading(false));
      });
  }, [refreshTrigger, clientId]);

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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {videos.map((v) => (
        <div
          key={v.id}
          className="rounded-xl border border-border bg-card overflow-hidden group"
        >
          {/* Video preview */}
          <div className="relative aspect-[9/16] bg-muted">
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
          </div>
        </div>
      ))}
    </div>
  );
}
