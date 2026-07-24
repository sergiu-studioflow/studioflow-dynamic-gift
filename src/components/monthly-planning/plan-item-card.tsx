"use client";

import { useState } from "react";
import { ImageIcon, Video, ChevronDown, ChevronRight, RefreshCw, SkipForward, Loader2, CheckCircle2, AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlanItem } from "./types";

const ITEM_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }> = {
  planned: { label: "Planned", variant: "outline" },
  briefing: { label: "Briefing…", variant: "secondary" },
  brief_ready: { label: "Brief ready", variant: "default" },
  producing: { label: "Producing…", variant: "secondary" },
  generated: { label: "Generated", variant: "success" },
  scheduled: { label: "Scheduled", variant: "success" },
  error: { label: "Error", variant: "destructive" },
  skipped: { label: "Skipped", variant: "outline" },
};

export function PlanItemCard({ item, planId, editable, onChanged }: { item: PlanItem; planId: string; editable: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<Record<string, unknown>>(item.brief?.payload || {});
  const s = ITEM_STATUS[item.status] || ITEM_STATUS.planned;

  async function patch(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await fetch(`/api/monthly-planning/plans/${planId}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const briefEditable = editable && item.brief && !["producing", "generated", "scheduled"].includes(item.status);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        {item.assetType === "static" ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <Video className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate text-xs font-medium">{item.title || item.topic || "Post"}</span>
        <Badge variant="outline" className="text-[9px] uppercase">{item.format}</Badge>
        {item.angleTag && <Badge variant="outline" className="hidden text-[9px] sm:inline-flex">{item.angleTag}</Badge>}
        <span className="ml-auto flex items-center gap-2">
          {item.previewUrl && <img src={item.previewUrl} alt="" className="h-7 w-7 rounded object-cover" />}
          <StatusIcon status={item.status} />
          <Badge variant={s.variant} className="text-[9px]">{s.label}</Badge>
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {item.topic && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Topic:</span> {item.topic}</p>}
          {item.direction && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Direction:</span> {item.direction}</p>}
          {item.errorMessage && <p className="text-[11px] text-destructive">{item.errorMessage}</p>}

          {item.brief && (
            <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.brief.briefType} brief</div>
              <div className="space-y-2">
                {Object.entries(payload).map(([k, v]) => (
                  <div key={k}>
                    <label className="text-[10px] font-medium uppercase text-muted-foreground">{k.replace(/_/g, " ")}</label>
                    {briefEditable ? (
                      <textarea
                        value={Array.isArray(v) ? (v as string[]).join("\n") : String(v ?? "")}
                        onChange={(e) => setPayload((p) => ({ ...p, [k]: Array.isArray(v) ? e.target.value.split("\n") : e.target.value }))}
                        onBlur={() => patch("edit_brief", { payload })}
                        rows={Array.isArray(v) || String(v ?? "").length > 80 ? 3 : 1}
                        className="mt-0.5 w-full resize-none rounded border border-input bg-background p-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                    ) : (
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-foreground/90">{Array.isArray(v) ? (v as string[]).join(" · ") : String(v ?? "")}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {briefEditable && (
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => patch("regenerate_brief")} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Regenerate brief
              </Button>
            )}
            {editable && !["scheduled", "skipped"].includes(item.status) && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => patch("skip")} disabled={busy}>
                <SkipForward className="mr-1 h-3 w-3" /> Skip
              </Button>
            )}
            {item.status === "scheduled" && (
              <a href="/posting" className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                In Post Scheduler <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "scheduled" || status === "generated") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "error") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "briefing" || status === "producing") return <Clock className="h-3.5 w-3.5 animate-pulse text-muted-foreground" />;
  return null;
}
