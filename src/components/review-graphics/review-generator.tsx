"use client";

import { useState } from "react";
import { Sparkles, Loader2, RefreshCw, Quote, AlertTriangle } from "lucide-react";
import { useClient } from "@/lib/client-context";
import { cn } from "@/lib/utils";

export function ReviewGenerator({ onGenerated }: { onGenerated: () => void }) {
  const { clientId, clientName, clientSlug, isReady } = useClient();
  const [count, setCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isIndigenous = clientSlug === "indigenous-promotions";

  async function pullLatest() {
    if (!clientId) return;
    setPulling(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/cron/review-ingest?clientId=${clientId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start review fetch");
      if (data.started > 0) {
        setMessage("Fetching the latest reviews from Google — new ones will appear within a few minutes. You can generate once they land.");
      } else if (data.skipped > 0) {
        setMessage("A review fetch is already running for this brand. Give it a minute, then generate.");
      } else {
        setError("This brand has no Google Maps URL configured for reviews yet. Add one in the brand settings.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch reviews");
    } finally {
      setPulling(false);
    }
  }

  async function generate() {
    if (!clientId) return;
    setGenerating(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/review-graphics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, limit: count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      if (data.count > 0) {
        setMessage(`Generating ${data.count} testimonial graphic set${data.count > 1 ? "s" : ""}. Opening the gallery…`);
        setTimeout(onGenerated, 600);
      } else {
        setMessage(data.message || "No new reviews with customer photos to generate from. Try 'Pull latest reviews' first.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  if (!isReady) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="rounded-2xl border border-border bg-card p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Quote className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Generate review graphics</h2>
            <p className="text-xs text-muted-foreground">
              Turns recent {clientName} reviews that include customer photos into branded testimonial
              graphics (Instagram feed, Story, Facebook) with matching captions.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {/* Count selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">How many reviews to turn into graphics?</label>
            <div className="mt-2 flex gap-2">
              {[1, 2, 3, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={cn(
                    "h-9 w-12 rounded-lg border text-sm font-medium transition-all",
                    count === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground/70">
              Picks the newest qualifying reviews (4★+ with a customer photo) that haven&apos;t been used yet.
              Every graphic lands as a draft for your approval before it&apos;s ready to post.
            </p>
          </div>

          {isIndigenous && (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Indigenous Promotions: review every graphic carefully for cultural representation before approving.
                Nothing is auto-published.
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={generate}
              disabled={generating || !clientId}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate graphics
            </button>
            <button
              onClick={pullLatest}
              disabled={pulling || !clientId}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground disabled:opacity-50"
            >
              {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Pull latest reviews
            </button>
          </div>

          {message && <p className="text-xs text-emerald-600 dark:text-emerald-400">{message}</p>}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <p className="text-[11px] text-muted-foreground/60 border-t border-border pt-4">
            New reviews are pulled automatically every day. Use &quot;Pull latest reviews&quot; to fetch on demand.
          </p>
        </div>
      </div>
    </div>
  );
}
