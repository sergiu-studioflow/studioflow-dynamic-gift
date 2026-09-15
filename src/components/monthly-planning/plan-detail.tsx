"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, CheckCircle2, Sparkles, Rocket, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlanItemCard } from "./plan-item-card";
import type { MonthlyPlan, PlanItem } from "./types";

const STAGES = [
  { key: "plan_ready", label: "Plan" },
  { key: "briefing", label: "Briefs" },
  { key: "briefs_ready", label: "Review" },
  { key: "producing", label: "Produce" },
  { key: "complete", label: "Scheduled" },
];
const STAGE_ORDER = ["planning", "plan_ready", "briefing", "briefs_ready", "producing", "complete"];
/** Planning with no heartbeat for this long has stalled (the server's lease is 8 minutes). */
const PLANNING_STALLED_MS = 10 * 60_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PlanDetail({ planId, onBack }: { planId: string; onBack: () => void }) {
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/monthly-planning/plans/${planId}`);
      if (res.ok) {
        setPlan(await res.json());
        setLoadedAt(Date.now());
      }
    } catch {
      // Keep the last good view; the poll tries again.
    }
    setLoading(false);
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  // Poll while planning, briefs or production run in the background.
  useEffect(() => {
    if (!plan || !["planning", "briefing", "producing"].includes(plan.status)) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [plan, load]);

  const counts = useMemo(() => {
    const items = plan?.items || [];
    const generated = (i: PlanItem) => i.generationStatus === "completed" || i.generationStatus === "complete";
    return {
      toProduce: items.filter((i) => i.assetType === "static" && i.status === "brief_ready").length,
      scheduled: items.filter((i) => i.status === "scheduled").length,
      videoReady: items.filter((i) => i.assetType === "video" && i.status === "generated").length,
      inProgress: items.filter((i) => ["brief_ready", "producing"].includes(i.status)).length,
      awaitingQc: items.filter((i) => i.status === "producing" && generated(i) && i.qcStatus === "pending").length,
      needsAttention: items.filter((i) => i.status === "error").length,
    };
  }, [plan]);

  async function advance(action: "approve_plan" | "produce" | "retry_planning") {
    if (action === "produce") {
      const message = counts.toProduce
        ? `Produce ${plural(counts.toProduce, "static ad")} and auto-schedule them? Each one generates an image (paid) and, once Quality Control clears it, is scheduled to publish to Facebook/Instagram automatically.`
        : "Start production? There are no static ads to generate — video briefs will be marked ready.";
      if (!confirm(message)) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/monthly-planning/plans/${planId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Failed");
      }
      await load();
    } catch {
      alert("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  const byBrand = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of plan?.items || []) {
      const list = m.get(it.brandName) || [];
      list.push(it);
      m.set(it.brandName, list);
    }
    return [...m.entries()];
  }, [plan]);

  if (loading) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!plan) return <p className="text-sm text-muted-foreground">Plan not found.</p>;

  const currentIdx = STAGE_ORDER.indexOf(plan.status === "scheduled" ? "complete" : plan.status);
  const editable = ["plan_ready", "briefing", "briefs_ready"].includes(plan.status);
  const planningStalled = plan.status === "planning" && loadedAt - new Date(plan.updatedAt).getTime() > PLANNING_STALLED_MS;
  const finished = plan.status === "complete" || plan.status === "scheduled";
  const doneSummary = [
    counts.scheduled > 0 && `${plural(counts.scheduled, "static post")} sent to the Post Scheduler`,
    counts.videoReady > 0 && `${plural(counts.videoReady, "video brief")} ready`,
  ]
    .filter(Boolean)
    .join("; ");

  const retryButton = (label: string) => (
    <Button size="sm" variant="outline" className="shrink-0" onClick={() => advance("retry_planning")} disabled={busy}>
      {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} {label}
    </Button>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /></button>
        <h2 className="text-base font-semibold">{plan.title || plan.month}</h2>
        <Badge variant="outline" className="text-[10px]">{(plan.items?.length ?? 0)} slots</Badge>
      </div>

      {/* Stage bar */}
      <div className="flex items-center gap-2">
        {STAGES.map((st, i) => {
          const done = STAGE_ORDER.indexOf(st.key) < currentIdx;
          const active = STAGE_ORDER.indexOf(st.key) === currentIdx;
          return (
            <div key={st.key} className="flex items-center gap-2">
              <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                {done && <CheckCircle2 className="h-3 w-3" />} {st.label}
              </span>
              {i < STAGES.length - 1 && <span className="h-px w-4 bg-border" />}
            </div>
          );
        })}
      </div>

      {/* Stage action */}
      <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
        {plan.status === "planning" && (
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {planningStalled
                ? "Planning is taking longer than expected — it continues automatically, or retry now."
                : `Planning the month… (${plan.items?.length ?? 0} slots so far — runs in the background, refreshes automatically)`}
            </p>
            {planningStalled && retryButton("Retry now")}
          </div>
        )}
        {plan.status === "error" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-destructive">{plan.errorMessage || "Something went wrong."}</p>
            {retryButton("Retry planning")}
          </div>
        )}
        {plan.status === "plan_ready" && (
          <div className="space-y-2">
            {plan.errorMessage && (
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {plan.errorMessage}
                </p>
                {retryButton("Retry those brands")}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Review + edit the plan below, then approve to generate briefs for every slot.</p>
              <Button size="sm" onClick={() => advance("approve_plan")} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} Approve & generate briefs
              </Button>
            </div>
          </div>
        )}
        {plan.status === "briefing" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Generating briefs… (runs in the background, refreshes automatically)</p>}
        {plan.status === "briefs_ready" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Review + edit the briefs below, then produce. Static slots generate ads and auto-schedule into the Post Scheduler once Quality Control clears them; video slots deliver the brief.</p>
            <Button size="sm" onClick={() => advance("produce")} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1 h-3.5 w-3.5" />} Produce & schedule
            </Button>
          </div>
        )}
        {plan.status === "producing" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Producing static ads + scheduling… {counts.inProgress} in progress
            {counts.awaitingQc > 0 && ` (${counts.awaitingQc} awaiting Quality Control)`} · {counts.scheduled} scheduled
            {counts.needsAttention > 0 && ` · ${counts.needsAttention} need attention`} (background, refreshes automatically)
          </p>
        )}
        {finished &&
          (counts.needsAttention > 0 ? (
            <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Finished with {plural(counts.needsAttention, "slot")} needing attention — use Retry on them below.
              {doneSummary && ` So far: ${doneSummary}.`}
            </p>
          ) : doneSummary ? (
            <p className="flex items-center gap-2 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4 shrink-0" /> Done — {doneSummary}.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Done — nothing was produced (every slot was skipped).</p>
          ))}
      </div>

      {/* Items grouped by brand */}
      <div className="space-y-5">
        {byBrand.map(([brand, items]) => (
          <div key={brand}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{brand} · {items.length}</h3>
            <div className="space-y-1.5">
              {items.map((it) => (
                // Keyed by brief too: a regenerated/retried brief remounts the card with the new payload.
                <PlanItemCard key={`${it.id}:${it.brief?.id ?? ""}`} item={it} planId={planId} editable={editable} now={loadedAt} onChanged={load} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
