"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Star, Quote, Sparkles, ImageIcon, Check, MessageSquare, Expand } from "lucide-react";
import { useClient } from "@/lib/client-context";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/review-graphics/lightbox";

type Review = {
  reviewId: string;
  reviewerName: string | null;
  stars: number | null;
  text: string | null;
  textTranslated: string | null;
  images: string[];
  archived: boolean;
  photoCount: number;
  publishedAt: string | null;
  qualifiesForRender: boolean | null;
  rendered: boolean;
};

/** Cropped thumbnail (fills a fixed-size box). Falls back to a placeholder if
 * the image URL is dead (stale Google CDN urls 403 until archived to R2). */
function ReviewThumb({ url, photoCount, archived }: { url: string | null; photoCount: number; archived: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/25">
        <ImageIcon className="h-8 w-8" />
        {photoCount > 0 && !archived && (
          <span className="text-[9px] text-muted-foreground/40">photo archives on next refresh</span>
        )}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="review photo" className="h-full w-full object-cover" onError={() => setBroken(true)} />;
}

const FILTERS = [
  { key: "qualifying", label: "Ready to use (photo + 4★)" },
  { key: "rendered", label: "Already generated" },
  { key: "all", label: "All reviews" },
];

export function ReviewList({ onGenerated }: { onGenerated: () => void }) {
  const { clientId, clientName, isReady } = useClient();
  const [filter, setFilter] = useState("qualifying");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/review-graphics/reviews?clientId=${clientId}&filter=${filter}`);
      const data = await res.json();
      setReviews(Array.isArray(data.reviews) ? data.reviews : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [clientId, filter]);

  useEffect(() => {
    if (isReady) load();
  }, [load, isReady]);

  async function generate(reviewId: string) {
    if (!clientId) return;
    setBusyId(reviewId);
    try {
      const res = await fetch("/api/review-graphics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, reviewId }),
      });
      const data = await res.json();
      if (res.ok && data.count > 0) {
        setTimeout(onGenerated, 400);
      }
    } finally {
      setBusyId(null);
    }
  }

  if (!isReady || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {reviews.length} {clientName} review{reviews.length === 1 ? "" : "s"}
        </span>
      </div>

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
          <MessageSquare className="h-12 w-12 mb-3" />
          <p className="text-sm">No reviews in this view</p>
          <p className="text-[11px] text-muted-foreground/30">
            {filter === "qualifying"
              ? "No 4★+ reviews with customer photos yet — try 'All reviews', or Pull latest reviews in the Generate tab"
              : "Pull latest reviews from the Generate tab"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
          {reviews.map((r) => {
            const hasImg = r.images.length > 0;
            return (
            <div key={r.reviewId} className="flex h-full flex-col rounded-xl border border-border bg-card overflow-hidden">
              {/* Photo — fixed height, cropped; click to expand */}
              <button
                type="button"
                onClick={() => hasImg && setLightbox(r.images)}
                className={cn("group relative h-44 w-full shrink-0 bg-muted", hasImg ? "cursor-zoom-in" : "cursor-default")}
              >
                <ReviewThumb url={r.images[0] || null} photoCount={r.photoCount} archived={r.archived} />
                {hasImg && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                    <Expand className="h-5 w-5 text-white" />
                  </span>
                )}
                {r.photoCount > 1 && (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    +{r.photoCount - 1}
                  </span>
                )}
                {r.rendered && (
                  <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium text-white">
                    <Check className="h-3 w-3" /> Generated
                  </span>
                )}
              </button>

              {/* Body */}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">{r.reviewerName || "Anonymous"}</span>
                  {r.stars != null && (
                    <span className="flex items-center gap-0.5 shrink-0">
                      {Array.from({ length: r.stars }).map((_, i) => (
                        <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                      ))}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground line-clamp-3">
                  <Quote className="mr-1 inline h-3 w-3 text-muted-foreground/40" />
                  {r.text || r.textTranslated || "(no text)"}
                </p>
                <button
                  onClick={() => generate(r.reviewId)}
                  disabled={busyId === r.reviewId}
                  className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {busyId === r.reviewId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {r.rendered ? "Generate again" : "Generate graphic"}
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {lightbox && <Lightbox images={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
