"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ImageIcon, Clapperboard, Megaphone, Video, Lightbulb, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";
import { ReviewScorecard, reviewVerdict, type GateReview } from "@/components/qc/review-scorecard";
import { RulesTab } from "@/components/qc/rules-tab";

const SYSTEMS = [
  { key: "static", label: "Static Ads", href: "/static-ads", Icon: ImageIcon },
  { key: "video", label: "Video Generation", href: "/video-generation", Icon: Clapperboard },
  { key: "ad_copy", label: "Ad Copy", href: "/ad-copy", Icon: Megaphone },
  { key: "video_brief", label: "Video Briefs", href: "/video-brief", Icon: Video },
  { key: "ideation", label: "Content Ideation", href: "/content-ideation", Icon: Lightbulb },
] as const;

type Providers = { gemini: boolean; claude: boolean; videoGradable: boolean; anyGradable: boolean };

const HELD_LIMIT = 12;
const RECENT_LIMIT = 15;

export function ComplianceDashboard({ role }: { role: string }) {
  const { clientId, clientName, isReady } = useClient();
  const canEdit = role !== "viewer";

  const [reviews, setReviews] = useState<GateReview[]>([]);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [tab, setTab] = useState<"overview" | "rules">("overview");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clientId) {
      setReviews([]);
      setLoading(false);
      return;
    }
    const [reviewsRes, configRes] = await Promise.all([
      fetch(`/api/qc/reviews?clientId=${clientId}`),
      fetch(`/api/qc/config?clientId=${clientId}`),
    ]);
    if (reviewsRes.ok) setReviews((await reviewsRes.json()).reviews ?? []);
    if (configRes.ok) setProviders((await configRes.json()).providers ?? null);
    setLoading(false);
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

  const isFlagged = (r: GateReview) => r.status === "complete" && r.overallPass === false;
  const held = reviews.filter(isFlagged);
  const completed = reviews.filter((r) => r.status === "complete");

  if (!isReady) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  if (!clientId) {
    return (
      <p className="text-sm text-muted-foreground">
        Quality Control is per-client — pick one in the sidebar switcher.
      </p>
    );
  }

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
            onClick={() => setTab(t)}
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
        <RulesTab clientId={clientId} clientName={clientName} canEdit={canEdit} />
      ) : loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-6">
          {/* Per-system roll-up */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SYSTEMS.map(({ key, label, href, Icon }) => {
              const mine = reviews.filter((r) => r.sourceSystem === key);
              const flagged = mine.filter(isFlagged).length;
              const inFlight = mine.filter((r) => r.status === "pending" || r.status === "running").length;
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
              Held for review{held.length > 0 ? ` (${held.length})` : ""}
            </h2>
            {held.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is being held. Everything graded so far passed this client&apos;s standards.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {held.slice(0, HELD_LIMIT).map((r) => (
                  <div key={r.id} className="flex gap-3 rounded-lg border border-rose-500/30 bg-card p-3">
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
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {SYSTEMS.find((s) => s.key === r.sourceSystem)?.label ?? r.sourceSystem}
                      </p>
                      <ReviewScorecard review={r} clientId={clientId} canEdit={canEdit} onChange={load} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {held.length > HELD_LIMIT ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {HELD_LIMIT} of {held.length}. Clear these to see the rest.
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

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

export { ShieldCheck };
