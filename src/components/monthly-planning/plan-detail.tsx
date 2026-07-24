"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, CheckCircle2, Sparkles, Rocket } from "lucide-react";
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

export function PlanDetail({ planId, onBack }: { planId: string; onBack: () => void }) {
  const [plan, setPlan] = useState<MonthlyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/monthly-planning/plans/${planId}`);
    if (res.ok) setPlan(await res.json());
    setLoading(false);
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  // Poll while briefs/production are in-flight.
  useEffect(() => {
    if (!plan || !["briefing", "producing"].includes(plan.status)) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [plan, load]);

  async function advance(action: "approve_plan" | "produce") {
    setBusy(true);
    try {
      const res = await fetch(`/api/monthly-planning/plans/${planId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Failed"); }
      await load();
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
        {plan.status === "error" && <p className="text-sm text-destructive">{plan.errorMessage || "Something went wrong."}</p>}
        {plan.status === "plan_ready" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Review + edit the plan below, then approve to generate briefs for every slot.</p>
            <Button size="sm" onClick={() => advance("approve_plan")} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} Approve & generate briefs
            </Button>
          </div>
        )}
        {plan.status === "briefing" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Generating briefs… (runs in the background, refreshes automatically)</p>}
        {plan.status === "briefs_ready" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Review + edit the briefs below, then produce. Static slots generate ads and auto-schedule into the Post Scheduler; video slots deliver the brief.</p>
            <Button size="sm" onClick={() => advance("produce")} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1 h-3.5 w-3.5" />} Produce & schedule
            </Button>
          </div>
        )}
        {plan.status === "producing" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Producing static ads + scheduling… (background, refreshes automatically)</p>}
        {(plan.status === "complete" || plan.status === "scheduled") && <p className="flex items-center gap-2 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4" /> Done — static posts are scheduled in the Post Scheduler; video briefs are ready.</p>}
      </div>

      {/* Items grouped by brand */}
      <div className="space-y-5">
        {byBrand.map(([brand, items]) => (
          <div key={brand}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{brand} · {items.length}</h3>
            <div className="space-y-1.5">
              {items.map((it) => (
                <PlanItemCard key={it.id} item={it} planId={planId} editable={editable} onChanged={load} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
