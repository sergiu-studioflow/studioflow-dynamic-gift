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

// After "Pull latest reviews" the tab drives the brand's fetch itself, so new
// reviews land while the page is open; past the cap the scheduled sweep finishes it.
const FETCH_POLL_MS = 20_000;
const FETCH_WATCH_MAX_MS = 10 * 60_000;

type GenerateResponse = {
  count?: number;
  message?: string;
  error?: string;
  errors?: Array<{ reviewerName?: string | null; error: string }>;
};

type FetchStartResponse = {
  error?: string;
  started?: number;
  skipped?: number;
  errors?: Array<{ brand: string; error: string }>;
  inProgress?: Array<{ lastError: string | null }>;
  notConfigured?: string | null;
};

type FetchProgressResponse = {
  stillRunning: number;
  latestRun: { status: string; errorMessage: string | null; reviewsNew: number } | null;
};

/** Failure text from a generate response (whole request or per review), or null. */
function generationFailure(data: GenerateResponse): string | null {
  if (data.error) return data.error;
  if (!Array.isArray(data.errors) || data.errors.length === 0) return null;
  return data.errors
    .map((e) => {
      const who = e.reviewerName?.trim().split(/\s+/)[0];
      return who ? `${who}: ${e.error}` : e.error;
    })
    .join(" · ");
}

export function ReviewList({ onGenerated }: { onGenerated: (notice?: string) => void }) {
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
  // Brand whose review fetch is being watched (null = none).
  const [watchingClientId, setWatchingClientId] = useState<string | null>(null);
  const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchId = useRef(0);
  const watching = watchingClientId !== null && watchingClientId === clientId;

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

  // Latest `load` and brand for the fetch watcher, which outlives renders.
  const loadRef = useRef(load);
  const clientIdRef = useRef(clientId);
  useEffect(() => {
    loadRef.current = load;
    clientIdRef.current = clientId;
  }, [load, clientId]);

  // Brand switch or unmount: stop driving a fetch started for the previous brand.
  // Bumping the (live) watch id invalidates a tick that's mid-request.
  useEffect(() => {
    const ids = watchId;
    const timer = watchTimer;
    return () => {
      ids.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setWatchingClientId(null);
    };
  }, [clientId]);

  // close the "generate newest" menu on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  /** Send one generate request; on success go to the gallery (carrying any partial failures), else show why. */
  async function requestGeneration(body: object, emptyMessage: string) {
    try {
      const res = await fetch("/api/review-graphics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: GenerateResponse = await res.json().catch(() => ({}));
      const failure = generationFailure(data);
      if (res.ok && (data.count ?? 0) > 0) {
        setTimeout(() => onGenerated(failure ?? undefined), 400);
      } else {
        setNotice({
          kind: "err",
          text: failure || data.message || (res.ok ? emptyMessage : `Generation failed (HTTP ${res.status}).`),
        });
      }
    } catch {
      setNotice({ kind: "err", text: "Generation failed — couldn't reach the server." });
    }
  }

  async function generate(reviewId: string) {
    if (!clientId) return;
    setBusyId(reviewId);
    setNotice(null);
    try {
      await requestGeneration({ clientId, reviewId }, "Nothing was generated for this review.");
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
      await requestGeneration({ clientId, limit: n }, "No new reviews with photos to generate from.");
    } finally {
      setBulkBusy(false);
    }
  }

  /** Poll the brand's in-flight review fetch until it finishes, fails, or the watch cap passes. */
  function watchReviewFetch(forClientId: string) {
    if (watchTimer.current) clearTimeout(watchTimer.current);
    const myWatch = ++watchId.current;
    const deadline = Date.now() + FETCH_WATCH_MAX_MS;
    setWatchingClientId(forClientId);

    const tick = async () => {
      watchTimer.current = null;
      let progress: FetchProgressResponse | null = null;
      try {
        const res = await fetch(`/api/review-graphics/reviews/fetch?clientId=${forClientId}`);
        if (res.ok) progress = await res.json();
      } catch {
        // transient — retry on the next tick
      }
      if (watchId.current !== myWatch || clientIdRef.current !== forClientId) return;

      if (progress && progress.stillRunning === 0) {
        setWatchingClientId(null);
        const run = progress.latestRun;
        if (run?.status === "error") {
          setNotice({ kind: "err", text: `Review fetch failed: ${run.errorMessage || "unknown error"}` });
        } else {
          const n = run?.reviewsNew ?? 0;
          setNotice({
            kind: "ok",
            text: n > 0 ? `Fetched ${n} new review${n === 1 ? "" : "s"} from Google.` : "Review fetch finished — no new reviews since the last fetch.",
          });
        }
        loadRef.current();
        return;
      }
      if (Date.now() >= deadline) {
        setWatchingClientId(null);
        setNotice({
          kind: "ok",
          text: "The review fetch is still running. Its reviews will be added by the background sync when it finishes — check back later.",
        });
        return;
      }
      watchTimer.current = setTimeout(tick, FETCH_POLL_MS);
    };

    watchTimer.current = setTimeout(tick, FETCH_POLL_MS);
  }

  async function pullLatest() {
    if (!clientId) return;
    const forClientId = clientId;
    setPulling(true);
    setNotice(null);
    try {
      const res = await fetch("/api/review-graphics/reviews/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: forClientId }),
      });
      const data: FetchStartResponse = await res.json().catch(() => ({}));
      if (clientIdRef.current !== forClientId) return; // brand switched mid-request
      if (!res.ok) throw new Error(data.error || `Couldn't start the review fetch (HTTP ${res.status}).`);

      if (data.errors && data.errors.length > 0) {
        setNotice({ kind: "err", text: `Couldn't start the review fetch: ${data.errors.map((e) => e.error).join(" · ")}` });
      } else if ((data.started ?? 0) > 0) {
        setNotice({
          kind: "ok",
          text: "Fetching the latest reviews from Google. This usually takes a few minutes — keep this page open and they'll appear here, or check back later.",
        });
        watchReviewFetch(forClientId);
      } else if ((data.skipped ?? 0) > 0) {
        const lastError = data.inProgress?.find((p) => p.lastError)?.lastError;
        setNotice({
          kind: "ok",
          text: `A review fetch for this brand is already running — waiting for it to finish.${lastError ? ` (Last check failed: ${lastError})` : ""}`,
        });
        watchReviewFetch(forClientId);
      } else {
        setNotice({ kind: "err", text: data.notConfigured || "This brand isn't set up for review fetching yet." });
      }
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "Failed to fetch reviews" });
    } finally {
      setPulling(false);
    }
  }

  if (!isReady) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!clientId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
        <MessageSquare className="h-12 w-12 mb-3" />
        <p className="text-sm">Select a brand to see its reviews</p>
        <p className="text-[11px] text-muted-foreground/50">Use the client switcher in the sidebar — reviews are fetched per brand.</p>
      </div>
    );
  }

  if (loading) {
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
            disabled={pulling || watching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:text-foreground hover:border-primary/30 disabled:opacity-50"
          >
            {pulling || watching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {watching ? "Fetching reviews…" : "Pull latest reviews"}
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
