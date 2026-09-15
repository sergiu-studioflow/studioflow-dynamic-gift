"use client";

import { useState } from "react";
import { ImageIcon, Video, ChevronDown, ChevronRight, RefreshCw, SkipForward, Loader2, CheckCircle2, AlertTriangle, Clock, ExternalLink, RotateCcw, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlanItem } from "./types";

type Variant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

const ITEM_STATUS: Record<string, { label: string; variant: Variant }> = {
  planned: { label: "Planned", variant: "outline" },
  briefing: { label: "Briefing…", variant: "secondary" },
  brief_ready: { label: "Brief ready", variant: "default" },
  producing: { label: "Producing…", variant: "secondary" },
  generated: { label: "Generated", variant: "success" },
  scheduled: { label: "Scheduled", variant: "success" },
  error: { label: "Error", variant: "destructive" },
  skipped: { label: "Skipped", variant: "outline" },
};

/** What happened to the post after the slot was scheduled (it can be changed in the Post Scheduler). */
const POST_STATUS: Record<string, { label: string; variant: Variant }> = {
  draft: { label: "Unscheduled", variant: "warning" },
  publishing: { label: "Publishing…", variant: "secondary" },
  published: { label: "Published", variant: "success" },
  partial: { label: "Partly published", variant: "warning" },
  failed: { label: "Publish failed", variant: "destructive" },
  cancelled: { label: "Post cancelled", variant: "outline" },
};

/** Matches the API: a slot left 'briefing' this long can be retried. */
const BRIEFING_STALE_MS = 10 * 60_000;

/** "Tue 4 Nov" for a YYYY-MM-DD plan date — a calendar date, so formatted in UTC to never shift a day. */
function fmtPlanDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

function fmtScheduled(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function statusFor(item: PlanItem): { label: string; variant: Variant } {
  if (item.status === "producing" && (item.generationStatus === "completed" || item.generationStatus === "complete")) {
    return item.qcStatus === "pending" ? { label: "Awaiting QC", variant: "warning" } : { label: "Scheduling…", variant: "secondary" };
  }
  if (item.status === "scheduled" && item.post && POST_STATUS[item.post.status]) return POST_STATUS[item.post.status];
  if (item.status === "generated" && item.assetType === "video") return { label: "Brief delivered", variant: "success" };
  return ITEM_STATUS[item.status] || ITEM_STATUS.planned;
}

export function PlanItemCard({
  item,
  planId,
  editable,
  now,
  onChanged,
}: {
  item: PlanItem;
  planId: string;
  editable: boolean;
  /** When the plan was loaded (ms) — keeps render pure. */
  now: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown>>(item.brief?.payload || {});
  const s = statusFor(item);

  async function patch(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/monthly-planning/plans/${planId}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionError(d.error || "That didn't work — try again.");
      }
      onChanged();
    } catch {
      setActionError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    const held = item.errorMessage?.startsWith("Held by Quality Control");
    if (held && !confirm("This ad is held by Quality Control — to use it as-is, approve it in the QC queue instead. Produce a new ad for this slot?")) {
      return;
    }
    patch("retry");
  }

  const briefEditable = editable && item.brief && !["producing", "generated", "scheduled"].includes(item.status);
  const staleBriefing = item.status === "briefing" && now - new Date(item.updatedAt).getTime() > BRIEFING_STALE_MS;
  // Left 'generated' by the old QC release path: the ad exists but was never scheduled.
  const strandedStatic = item.status === "generated" && item.assetType === "static" && !!item.generationId;
  const canRetry = item.status === "error" || staleBriefing || strandedStatic;
  const canSkip = (editable || item.status === "error") && !["scheduled", "skipped"].includes(item.status);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        {item.assetType === "static" ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <Video className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
          <CalendarDays className="h-3 w-3" /> {fmtPlanDate(item.plannedDate)}
        </span>
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
          {item.status === "scheduled" && item.post?.scheduledAt && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Posting:</span> {fmtScheduled(item.post.scheduledAt, item.post.timezone)}
              {item.post.status !== "scheduled" && ` (${s.label.toLowerCase()})`}
            </p>
          )}
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

          <div className="flex flex-wrap items-center gap-2">
            {canRetry && (
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={retry} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />} Retry
              </Button>
            )}
            {briefEditable && (
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => patch("regenerate_brief")} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Regenerate brief
              </Button>
            )}
            {canSkip && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => patch("skip")} disabled={busy}>
                <SkipForward className="mr-1 h-3 w-3" /> Skip
              </Button>
            )}
            {item.scheduledPostId && (
              <a href="/posting" className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                In Post Scheduler <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {actionError && <span className="text-[11px] text-destructive">{actionError}</span>}
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
