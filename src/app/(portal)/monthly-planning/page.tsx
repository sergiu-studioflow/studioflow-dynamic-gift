"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, Plus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NewPlanForm } from "@/components/monthly-planning/new-plan-form";
import { PlanDetail } from "@/components/monthly-planning/plan-detail";
import type { MonthlyPlan } from "@/components/monthly-planning/types";

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning…", plan_ready: "Plan ready", briefing: "Generating briefs…",
  briefs_ready: "Briefs ready", producing: "Producing…", scheduled: "Scheduled", complete: "Complete", error: "Error",
};

export default function MonthlyPlanningPage() {
  const [view, setView] = useState<"list" | "new">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plans, setPlans] = useState<MonthlyPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/monthly-planning/plans");
    if (res.ok) setPlans(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { if (!selectedId) load(); }, [selectedId, load]);

  async function del(id: string) {
    if (!confirm("Delete this plan? (Scheduled posts stay in the Post Scheduler.)")) return;
    const res = await fetch(`/api/monthly-planning/plans/${id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); alert(d.error || "Failed to delete"); return; }
    load();
  }

  return (
    <div className="flex h-full flex-col -m-10 -mt-12">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-6 py-3">
        <CalendarRange className="mr-1 h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Monthly Planning</span>
        {!selectedId && view === "list" && (
          <Button size="sm" className="ml-auto" onClick={() => setView("new")}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New plan
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selectedId ? (
          <PlanDetail planId={selectedId} onBack={() => setSelectedId(null)} />
        ) : view === "new" ? (
          <NewPlanForm onCreated={(id) => { setView("list"); setSelectedId(id); }} onCancel={() => setView("list")} />
        ) : loading ? (
          <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            <CalendarRange className="h-6 w-6" />
            <p className="max-w-sm">No monthly plans yet. Create one — pick your brands, themes and campaigns, and the system drafts the whole month.</p>
            <Button size="sm" onClick={() => setView("new")}><Plus className="mr-1 h-3.5 w-3.5" /> New plan</Button>
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40">
                <button onClick={() => setSelectedId(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.title || p.month}</div>
                    <div className="text-xs text-muted-foreground">{p.itemCount ?? 0} slots · {new Date(p.createdAt).toLocaleDateString("en-AU")}</div>
                  </div>
                </button>
                <Badge variant={p.status === "complete" ? "success" : p.status === "error" ? "destructive" : "secondary"} className="text-[10px]">
                  {STATUS_LABEL[p.status] || p.status}
                </Badge>
                <button onClick={() => del(p.id)} className="text-muted-foreground transition-colors hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
