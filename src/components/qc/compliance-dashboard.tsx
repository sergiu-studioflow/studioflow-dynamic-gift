"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ImageIcon, Clapperboard, Megaphone, Video, Lightbulb, Loader2, ShieldCheck, ArrowUpRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";
import { Button } from "@/components/ui/button";
import { ReviewScorecard, needsDecision, reviewVerdict, type GateReview } from "@/components/qc/review-scorecard";
import { RulesTab } from "@/components/qc/rules-tab";

const SYSTEMS = [
  { key: "static", label: "Static Ads", href: "/static-ads", Icon: ImageIcon },
  { key: "video", label: "Video Generation", href: "/video-generation", Icon: Clapperboard },
  { key: "ad_copy", label: "Ad Copy", href: "/ad-copy", Icon: Megaphone },
  { key: "video_brief", label: "Video Briefs", href: "/video-brief", Icon: Video },
  { key: "ideation", label: "Content Ideation", href: "/content-ideation", Icon: Lightbulb },
] as const;

// Text lanes, with what one piece is called.
const TEXT_PIECE: Partial<Record<string, string>> = { ad_copy: "ad copy concept", video_brief: "video brief", ideation: "idea" };

type Providers = { gemini: boolean; claude: boolean; videoGradable: boolean; anyGradable: boolean };

const HELD_LIMIT = 12;
const RECENT_LIMIT = 15;

export function ComplianceDashboard({ role }: { role: string }) {
  const { clientId, clientName, isReady, clientsError } = useClient();
  const canEdit = role !== "viewer";
  // Lives above the per-client view so switching brands keeps you on the same tab.
  const [tab, setTab] = useState<"overview" | "rules">("overview");

  if (!isReady) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  if (!clientId) {
    return (
      <p className="text-sm text-muted-foreground">
        {clientsError ?? "Quality Control is per-client — pick one in the sidebar switcher."}
      </p>
    );
  }

  // Keyed by client: switching brands remounts with empty state, so nothing from the previous
  // brand (reviews, a half-loaded ruleset, an in-flight response) can show up under the new one.
  return (
    <ClientQualityControl
      key={clientId}
      clientId={clientId}
      clientName={clientName}
      canEdit={canEdit}
      tab={tab}
      onTabChange={setTab}
    />
  );
}

function ClientQualityControl({
  clientId,
  clientName,
  canEdit,
  tab,
  onTabChange,
}: {
  clientId: string;
  clientName: string;
  canEdit: boolean;
  tab: "overview" | "rules";
  onTabChange: (tab: "overview" | "rules") => void;
}) {
  const [reviews, setReviews] = useState<GateReview[]>([]);
  const [held, setHeld] = useState<GateReview[]>([]);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Polls overlap when a load is slow; only the newest one may write state.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const q = `clientId=${encodeURIComponent(clientId)}`;
      const [reviewsRes, heldRes, configRes] = await Promise.all([
        fetch(`/api/qc/reviews?${q}`),
        fetch(`/api/qc/reviews?${q}&queue=held`),
        fetch(`/api/qc/config?${q}`),
      ]);
      if (!reviewsRes.ok || !heldRes.ok) throw new Error(`HTTP ${reviewsRes.status}/${heldRes.status}`);
      const [reviewsData, heldData, configData] = await Promise.all([
        reviewsRes.json(),
        heldRes.json(),
        configRes.ok ? configRes.json() : Promise.resolve(null),
      ]);
      if (seq !== loadSeq.current) return;
      setReviews(reviewsData.reviews ?? []);
      setHeld(heldData.reviews ?? []);
      if (configData) setProviders(configData.providers ?? null);
      setLoaded(true);
      setError(null);
    } catch {
      if (seq !== loadSeq.current) return;
      setError("Couldn't load the Quality Control queue. Check your connection and refresh the page.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const grading = useMemo(() => reviews.filter((r) => r.status === "pending" || r.status === "running").length, [reviews]);

  // Pump the grader while anything is in flight so verdicts land without a page refresh.
  useEffect(() => {
    if (grading === 0) return;
    const timer = setInterval(async () => {
      try {
        await fetch("/api/qc/tick", { method: "POST" });
        load();
      } catch {
        /* the cron is the backstop */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [grading, load]);

  const queue = held.filter(needsDecision);
  const completed = reviews.filter((r) => r.status === "complete" || r.status === "dismissed");

  return (
    <div className="space-y-6">
      {/* Configuration warnings — never let a silent misconfiguration look like "all clear". */}
      {providers && !providers.anyGradable ? (
        <Banner>
          No judge is configured, so nothing can be graded. Add an <strong>Anthropic</strong> or <strong>Gemini</strong> key in
          Settings → API Keys. Until then new pieces are flagged for human review — never auto-approved unseen.
        </Banner>
      ) : providers && !providers.videoGradable ? (
        <Banner>
          Video grading needs a <strong>Gemini</strong> key (Claude cannot read video) — add <code>GEMINI_API_KEY</code> in
          Settings → API Keys. Statics and copy are grading normally on Anthropic; videos are flagged for human review.
        </Banner>
      ) : null}

      <div className="flex gap-1 border-b border-border">
        {(["overview", "rules"] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={cn(
              "px-3 py-2 text-sm font-medium capitalize transition-colors",
              tab === t ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "rules" ? (
        <RulesTab key={clientId} clientId={clientId} clientName={clientName} canEdit={canEdit} />
      ) : loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : !loaded ? (
        // Never show "nothing is being held" for a queue that couldn't be read.
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : (
        <div className="space-y-6">
          {error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}

          {/* Per-system roll-up */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SYSTEMS.map(({ key, label, href, Icon }) => {
              const flagged = queue.filter((r) => r.sourceSystem === key).length;
              const inFlight = reviews.filter(
                (r) => r.sourceSystem === key && (r.status === "pending" || r.status === "running")
              ).length;
              return (
                <Link
                  key={key}
                  href={href}
                  className="rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50"
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 text-primary" />
                    {label}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {flagged > 0 ? (
                      <span className="font-medium text-rose-600 dark:text-rose-400">{flagged} held for review</span>
                    ) : (
                      <span>Nothing held</span>
                    )}
                    {inFlight > 0 ? <span> · {inFlight} grading…</span> : null}
                  </p>
                </Link>
              );
            })}
          </div>

          {/* The queue */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              Held for review{queue.length > 0 ? ` (${queue.length})` : ""}
            </h2>
            {queue.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is being held. Everything graded so far passed this client&apos;s standards.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {queue.slice(0, HELD_LIMIT).map((r) => (
                  <HeldItem key={r.id} review={r} clientId={clientId} canEdit={canEdit} onChange={load} />
                ))}
              </div>
            )}
            {queue.length > HELD_LIMIT ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {HELD_LIMIT} of {queue.length}. Clear these to see the rest.
              </p>
            ) : null}
          </section>

          {/* Audit trail */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">Recent decisions</h2>
            {completed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No grades yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {completed.slice(0, RECENT_LIMIT).map((r) => {
                  const v = reviewVerdict(r);
                  const system = SYSTEMS.find((s) => s.key === r.sourceSystem);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span className="truncate text-muted-foreground">
                        {system ? (
                          <Link href={system.href} className="hover:text-foreground hover:underline">
                            {system.label}
                          </Link>
                        ) : (
                          r.sourceSystem
                        )}
                        <span className="ml-2">{new Date(r.createdAt).toLocaleString()}</span>
                      </span>
                      <span className={cn("shrink-0 font-medium", v.tone)}>{v.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** One piece awaiting a decision: what was generated (image, clip or text), where it lives, and the scorecard. */
function HeldItem({
  review: r,
  clientId,
  canEdit,
  onChange,
}: {
  review: GateReview;
  clientId: string;
  canEdit: boolean;
  onChange: () => void;
}) {
  const system = SYSTEMS.find((s) => s.key === r.sourceSystem);
  const text = r.sourceText ?? r.copyText ?? null;
  // Text requests open straight to the request, expanded with held pieces shown.
  const sourceHref = system ? (r.requestId ? `${system.href}?request=${encodeURIComponent(r.requestId)}` : system.href) : null;
  // The held queue sends the text of every text piece that still exists, so no text means the
  // idea/concept/brief was deleted or re-generated — nothing left to approve, only to remove.
  const textPiece = Object.hasOwn(TEXT_PIECE, r.sourceSystem) ? TEXT_PIECE[r.sourceSystem] : undefined;
  const orphaned = !!textPiece && !r.sourceText;
  const [removing, setRemoving] = useState(false);

  async function removeOrphan() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/qc/reviews/${r.id}?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Failed to remove the review");
      }
      onChange();
    } catch {
      alert("Network error — the review was not removed.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex gap-3 rounded-lg border border-rose-500/30 bg-card p-3">
      {r.assetUrl ? (
        <div className="h-32 w-32 shrink-0 overflow-hidden rounded-md bg-muted">
          {r.sourceSystem === "video" ? (
            <video src={r.assetUrl} controls muted preload="metadata" className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.assetUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-muted-foreground">{system?.label ?? r.sourceSystem}</span>
          {sourceHref ? (
            <Link href={sourceHref} className="inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline">
              Open in {system?.label} <ArrowUpRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
        {orphaned ? (
          <div className="space-y-2 rounded-md bg-muted/50 p-2 text-xs">
            <p className="italic text-muted-foreground">
              This {textPiece} no longer exists — it was deleted or re-generated, so there is nothing left
              to approve.
            </p>
            {canEdit ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={removing} onClick={removeOrphan}>
                {removing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                Remove from queue
              </Button>
            ) : null}
          </div>
        ) : !r.assetUrl && text ? (
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-sans text-xs leading-relaxed text-foreground">
            {text}
          </pre>
        ) : null}
        {orphaned ? null : <ReviewScorecard review={r} clientId={clientId} canEdit={canEdit} onChange={onChange} />}
      </div>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

export { ShieldCheck };
