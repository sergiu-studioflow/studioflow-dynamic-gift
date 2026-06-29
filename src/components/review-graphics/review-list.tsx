"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Star, Quote, Sparkles, ImageIcon, Check, MessageSquare, Expand, RefreshCw, ChevronDown, AlertTriangle } from "lucide-react";
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
  const { clientId, clientName, clientSlug, isReady } = useClient();
  const [filter, setFilter] = useState("qualifying");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string[] | null>(null);
  const [pulling, setPulling] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  // close the "generate newest" menu on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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

  async function generateNewest(n: number) {
    if (!clientId) return;
    setMenuOpen(false);
    setBulkBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/review-graphics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, limit: n }),
      });
      const data = await res.json();
      if (res.ok && data.count > 0) {
        setTimeout(onGenerated, 400);
      } else {
        setNotice({ kind: "err", text: data.message || "No new reviews with photos to generate from." });
      }
    } catch {
      setNotice({ kind: "err", text: "Generation failed." });
    } finally {
      setBulkBusy(false);
    }
  }

  async function pullLatest() {
    if (!clientId) return;
    setPulling(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/cron/review-ingest?clientId=${clientId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start review fetch");
      if (data.started > 0) {
        setNotice({ kind: "ok", text: "Fetching the latest reviews from Google — new ones appear within a few minutes." });
      } else if (data.skipped > 0) {
        setNotice({ kind: "ok", text: "A review fetch is already running — give it a minute, then refresh." });
      } else {
        setNotice({ kind: "err", text: "This brand has no Google Maps URL configured for reviews yet." });
      }
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "Failed to fetch reviews" });
    } finally {
      setPulling(false);
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
      {/* Toolbar: filters (left) + actions (right) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                filter === f.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {reviews.length} {clientName} review{reviews.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={pullLatest}
            disabled={pulling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:text-foreground hover:border-primary/30 disabled:opacity-50"
          >
            {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Pull latest reviews
          </button>
          {/* Generate newest N */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate newest
              <ChevronDown className="h-3.5 w-3.5 opacity-80" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                {[1, 2, 3, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => generateNewest(n)}
                    className="flex w-full items-center justify-between px-3 py-2 text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    <span>Newest {n}</span>
                    <span className="text-[10px] text-muted-foreground">review{n === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {clientSlug === "indigenous-promotions" && (
        <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Indigenous Promotions: review every graphic carefully for cultural representation before approving. Nothing is auto-published.</span>
        </div>
      )}

      {notice && (
        <p className={cn("text-xs", notice.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
          {notice.text}
        </p>
      )}

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
          <MessageSquare className="h-12 w-12 mb-3" />
          <p className="text-sm">No reviews in this view</p>
          <p className="text-[11px] text-muted-foreground/30">
            {filter === "qualifying"
              ? "No 4★+ reviews with customer photos yet — try 'All reviews', or hit 'Pull latest reviews'"
              : "Hit 'Pull latest reviews' to fetch from Google"}
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
