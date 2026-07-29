"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, ShieldQuestion, RotateCcw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";

export type QcCriterion = {
  key: string;
  label: string;
  score: number;
  pass: boolean;
  note: string;
  assessed: boolean;
  gating: boolean;
};

export type GateReview = {
  id: string;
  clientId: string | null;
  sourceSystem: string;
  sourceId: string | null;
  assetPath: string | null;
  assetUrl?: string | null;
  status: string;
  overallPass: boolean | null;
  criteriaJson: QcCriterion[] | null;
  reviewer: string;
  overridden: boolean;
  notes: string | null;
  errorMessage: string | null;
  rulesetVersion: number | null;
  createdAt: string;
};

/**
 * Drive grading from the UI. While `active`, POST /api/qc/tick every 5s so a verdict lands
 * within seconds of generation instead of waiting for the 15-minute cron. The callback is
 * held in a ref so an inline `() => refetch()` doesn't reset the interval on every render.
 */
export function useQcAutoGrade(active: boolean, onGraded: () => void) {
  const cb = useRef(onGraded);
  cb.current = onGraded;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        await fetch("/api/qc/tick", { method: "POST" });
        cb.current();
      } catch {
        /* transient — the cron is the backstop */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [active]);
}

const BADGES: Record<string, { label: string; className: string; Icon: typeof ShieldCheck }> = {
  approved: { label: "QC passed", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", Icon: ShieldCheck },
  flagged: { label: "QC flagged", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400", Icon: ShieldAlert },
  rejected: { label: "QC rejected", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400", Icon: ShieldAlert },
  pending: { label: "QC…", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400", Icon: ShieldQuestion },
};

/** Small status pill for gallery cards and list rows. Renders nothing for skipped/absent. */
export function QcBadge({ qcStatus, className }: { qcStatus?: string | null; className?: string }) {
  const badge = qcStatus ? BADGES[qcStatus] : undefined;
  if (!badge) return null;
  const { label, className: tone, Icon } = badge;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tone, className)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function reviewVerdict(r: GateReview): { label: string; tone: string } {
  if (r.status === "pending" || r.status === "running") return { label: "Grading…", tone: "text-amber-600 dark:text-amber-400" };
  if (r.status === "failed") return { label: "Error", tone: "text-rose-600 dark:text-rose-400" };
  if (r.overallPass === true) return { label: r.overridden ? "Approved (human)" : "Passed", tone: "text-emerald-600 dark:text-emerald-400" };
  return { label: r.overridden ? "Rejected (human)" : "Flagged", tone: "text-rose-600 dark:text-rose-400" };
}

/** The per-criterion breakdown plus the human decision buttons. */
export function ReviewScorecard({
  review,
  clientId,
  canEdit,
  onChange,
}: {
  review: GateReview;
  clientId: string | null;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const verdict = reviewVerdict(review);
  const criteria = review.criteriaJson ?? [];

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/qc/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, clientId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Failed to update the review");
      }
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={cn("font-semibold", verdict.tone)}>{verdict.label}</span>
        {review.rulesetVersion ? <span className="text-muted-foreground">· rules v{review.rulesetVersion}</span> : null}
      </div>

      {review.errorMessage && review.status === "failed" ? (
        <p className="text-rose-600 dark:text-rose-400">{review.errorMessage}</p>
      ) : null}

      <ul className="space-y-1.5">
        {criteria.map((c) => (
          <li key={c.key} className="flex gap-2">
            <span
              className={cn(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                !c.assessed ? "bg-muted-foreground/40" : c.pass ? "bg-emerald-500" : "bg-rose-500"
              )}
            />
            <div className="min-w-0">
              <span className="font-medium">{c.label}</span>
              {!c.gating ? <span className="ml-1 text-muted-foreground">(advisory)</span> : null}
              {!c.assessed ? <span className="ml-1 italic text-muted-foreground">n/a</span> : null}
              {c.note ? <p className="text-muted-foreground">{c.note}</p> : null}
            </div>
          </li>
        ))}
      </ul>

      {review.notes ? <p className="text-muted-foreground">{review.notes}</p> : null}

      {canEdit && review.status === "complete" ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {review.overallPass !== true ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => act({ overallPass: true })}>
              <Check className="mr-1 h-3 w-3" /> Approve
            </Button>
          ) : null}
          {review.overallPass !== false ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => act({ overallPass: false })}>
              <X className="mr-1 h-3 w-3" /> Reject
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => act({ action: "regenerate" })}>
            <RotateCcw className="mr-1 h-3 w-3" /> Re-grade
          </Button>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Self-contained panel for a single review — used inside gallery detail dialogs. */
export function QcReviewPanel({ reviewId }: { reviewId: string }) {
  const { clientId } = useClient();
  const [review, setReview] = useState<GateReview | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) return;
    const res = await fetch(`/api/qc/reviews/${reviewId}?clientId=${clientId}`);
    if (!res.ok) return;
    const data = await res.json();
    setReview(data.review);
    setCanEdit(!!data.canEdit);
  }, [reviewId, clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const grading = review?.status === "pending" || review?.status === "running";
  useQcAutoGrade(!!grading, load);

  if (!review) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Quality Control
      </p>
      <ReviewScorecard review={review} clientId={clientId} canEdit={canEdit} onChange={load} />
    </div>
  );
}

/** Filter tabs shared by both galleries. */
export const QC_FILTERS = [
  { value: "default", label: "All" },
  { value: "ready", label: "Ready to Launch" },
  { value: "flagged", label: "Needs Review" },
] as const;
