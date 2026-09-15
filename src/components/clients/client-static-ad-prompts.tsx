"use client";

/**
 * Static-Ad Prompt Builder panel.
 *
 * A brand can't produce static ads until it has a brand-specific Agent 1 and
 * Agent 2 prompt. This runs the research pipeline that drafts them, shows the
 * draft, and publishes only on explicit approval — the Agent 1/2 prompts are
 * FIXED per brand, so a reviewed publish is the only way they ever change.
 * Whatever a publish or restore replaces is kept as an earlier version and can be
 * restored — including prompts that were written by hand.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, RotateCcw, Check, X, AlertTriangle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type JobSummary = {
  id: string;
  status: string;
  stage: string | null;
  errorMessage: string | null;
  createdAt: string;
  publishedAt: string | null;
};

/** Prompts that were live until a publish or restore replaced them. */
type SnapshotSummary = {
  id: string;
  replacedAt: string;
  liveSince: string | null;
  wasPlaceholder: boolean;
};

type Status = {
  isPlaceholder: boolean;
  hasConfig: boolean;
  brandType: "products" | "services";
  vertical: string | null;
  hasGuidelines: boolean;
  productCount: number;
  referenceUrls: string[];
  promptsUpdatedAt: string | null;
  jobs: JobSummary[];
  snapshots: SnapshotSummary[];
};

type CriticReport = {
  agent1?: { passes: boolean; issues: string[] };
  agent2?: { passes: boolean; issues: string[] };
  overallVerdict?: string;
};

type JobDetail = {
  id: string;
  status: string;
  stage: string | null;
  errorMessage: string | null;
  brandDna: { document?: string } | null;
  agent1Prompt: string | null;
  agent2Prompt: string | null;
  criticReport: CriticReport | null;
};

const STAGE_LABELS: Record<string, string> = {
  research: "Researching brand DNA (web + vision)",
  vibe: "Reading brand vibe",
  study: "Studying products / services",
  author1: "Authoring Agent 1",
  author2: "Authoring Agent 2",
  critique: "QC + output-contract check",
  publish: "Publishing",
};

const TERMINAL = new Set(["published", "error", "awaiting_review", "rejected"]);

/**
 * `canManage`: generating, approving, rejecting and restoring are admin-only on the
 * server, so for anyone else those controls are disabled with a note instead of
 * failing with a 403 after the click.
 */
export function ClientStaticAdPrompts({ clientSlug, canManage }: { clientSlug: string; canManage: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [brandType, setBrandType] = useState<"products" | "services">("products");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobDetail | null>(null);
  // A published job or snapshot opened for reading — kept apart from activeJob so
  // reading an old version never hides a draft that is waiting for review.
  const [viewed, setViewed] = useState<JobDetail | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDetail = useCallback(
    async (jobId: string) => {
      const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts/${jobId}`);
      if (res.ok) setActiveJob(await res.json());
    },
    [clientSlug]
  );

  const applyStatus = useCallback(
    (data: Status) => {
      setStatus({ ...data, snapshots: Array.isArray(data.snapshots) ? data.snapshots : [] });
      setBrandType(data.brandType);
      const latest = data.jobs[0];
      if (latest && (latest.status === "running" || latest.status === "pending")) {
        setActiveJobId(latest.id);
      } else if (latest && latest.status === "awaiting_review") {
        loadDetail(latest.id);
      }
    },
    [loadDetail]
  );

  const loadStatus = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts`);
    if (!res.ok) return;
    applyStatus(await res.json());
  }, [clientSlug, applyStatus]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientSlug}/static-ad-prompts`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Status | null) => {
        if (!cancelled && data) applyStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientSlug, applyStatus]);

  // Poll the active job until it leaves the running state. A build is minutes
  // long, so the panel has to survive a page refresh — loadStatus() re-attaches
  // to whatever is in flight rather than relying on this component's state.
  useEffect(() => {
    if (!activeJobId) return;
    const tick = async () => {
      const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts/${activeJobId}`);
      if (!res.ok) return;
      const job: JobDetail = await res.json();
      setActiveJob(job);
      if (TERMINAL.has(job.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        setActiveJobId(null);
        setBusy(false);
        if (job.status === "error") setError(job.errorMessage || "Generation failed.");
        loadStatus();
      }
    };
    tick();
    pollRef.current = setInterval(tick, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeJobId, clientSlug, loadStatus]);

  async function toggleView(jobId: string) {
    if (viewed?.id === jobId) {
      setViewed(null);
      return;
    }
    const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts/${jobId}`);
    if (res.ok) setViewed(await res.json());
    else setError("Couldn't load that version.");
  }

  async function generate() {
    setBusy(true);
    setError("");
    setActiveJob(null);
    const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandType }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to start generation.");
      setBusy(false);
      return;
    }
    const { jobId } = await res.json();
    setActiveJobId(jobId);
  }

  async function review(jobId: string, action: "approve" | "reject") {
    if (
      action === "approve" &&
      !confirm(
        status?.hasConfig
          ? "Publish these prompts live for this brand? The prompts live now are kept under “Earlier live prompts” and can be restored."
          : "Publish these prompts live for this brand?"
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Action failed.");
      return;
    }
    setActiveJob(null);
    setViewed(null);
    loadStatus();
  }

  async function restore(jobId: string) {
    if (!confirm("Restore these prompts as this brand's live prompts? The prompts live now are kept and can be restored too.")) {
      return;
    }
    const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Rollback failed.");
      return;
    }
    setViewed(null);
    loadStatus();
  }

  const running = busy || !!activeJobId;
  const inReview = activeJob?.status === "awaiting_review";
  const lastPublished = status?.jobs.find((j) => j.status === "published");
  const critic = activeJob?.criticReport;
  const criticIssues = [...(critic?.agent1?.issues ?? []), ...(critic?.agent2?.issues ?? [])].filter(
    (i) => i && i !== "critic-unavailable"
  );

  return (
    <div className="rounded-xl border border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> Static Ad System Prompts
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Researches the brand — website, Brand Intel, product images — and drafts the two prompts that drive every
            static ad it produces. Review the draft, then publish. Nothing goes live until you approve it, and the
            prompts it replaces can always be restored.
          </p>
        </div>
        {status && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
              inReview
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                : status.isPlaceholder
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
            )}
          >
            {inReview ? "Draft — needs review" : status.isPlaceholder ? "Generic prompts" : "Brand-specific"}
          </span>
        )}
      </div>

      {/* Readiness — what the build will and won't have to work with. */}
      {status && !inReview && (
        <div className="mt-3 space-y-2">
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-xs",
              status.hasGuidelines
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                : "bg-muted/50 text-muted-foreground"
            )}
          >
            {status.hasGuidelines ? (
              <>High-accuracy mode: this brand has confirmed colours and fonts on file, and the build uses them as the source of truth.</>
            ) : (
              <>
                The build reads the brand&rsquo;s website and its <span className="font-medium">Brand Intel</span>{" "}
                (identity, audience, USPs, voice, guardrails). Filling in the Brand Intel tab first produces more
                on-brand prompts. You can re-generate any time.
              </>
            )}
          </div>
          {status.productCount === 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No products on this brand yet. The build studies each product&rsquo;s image and copy to teach Agent 2
                how to render them — add products on the Products tab first, or the prompts stay generic about what
                the brand actually sells.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(["products", "services"] as const).map((bt) => (
            <button
              key={bt}
              type="button"
              disabled={running || !canManage}
              onClick={() => setBrandType(bt)}
              className={cn(
                "rounded-md px-3 py-1 text-xs capitalize transition-colors disabled:opacity-50",
                brandType === bt ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {bt}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={running || !canManage}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {running && !inReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running && !inReview
            ? "Generating…"
            : inReview
              ? "Re-generate"
              : status?.isPlaceholder
                ? "Generate brand prompts"
                : "Re-generate"}
        </button>
        {status?.promptsUpdatedAt && !status.isPlaceholder && !inReview && (
          <span className="text-xs text-muted-foreground">
            Live since {new Date(status.promptsUpdatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {!canManage && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" />
          Only admins can generate, publish, reject or restore these prompts.
        </p>
      )}

      {/* Live progress */}
      {running && !inReview && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {activeJob?.stage ? (STAGE_LABELS[activeJob.stage] ?? activeJob.stage) : "Starting…"}
            <span className="ml-2 text-xs text-muted-foreground">
              Takes a few minutes — you can leave this page and come back.
            </span>
          </span>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Review panel — draft awaiting approval */}
      {inReview && activeJob && (
        <div className="mt-4 rounded-lg border border-blue-300/50 bg-blue-50/40 p-4 dark:bg-blue-950/20">
          <p className="text-sm font-medium">Review this draft before it goes live</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Both prompts already passed the output-contract test — they were run against a real reference ad and
            produced parseable output. The QC notes below are advisory.
          </p>
          {criticIssues.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <span className="font-medium">QC flagged ({criticIssues.length}):</span>
              <ul className="mt-1 list-disc pl-4">
                {criticIssues.slice(0, 6).map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 space-y-2">
            {activeJob.brandDna?.document && <Panel title="Brand DNA" text={activeJob.brandDna.document} />}
            {activeJob.agent1Prompt && <Panel title="Agent 1 (reference analyst)" text={activeJob.agent1Prompt} />}
            {activeJob.agent2Prompt && <Panel title="Agent 2 (prompt writer)" text={activeJob.agent2Prompt} />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !canManage}
              onClick={() => review(activeJob.id, "approve")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Approve &amp; Publish
            </button>
            <button
              type="button"
              disabled={busy || !canManage}
              onClick={() => review(activeJob.id, "reject")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        </div>
      )}

      {/* Last published — inspect what the builder last put live */}
      {lastPublished && !running && !inReview && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => toggleView(lastPublished.id)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {viewed?.id === lastPublished.id ? "Hide" : "View"} last published Brand DNA + prompts
          </button>
          {viewed?.id === lastPublished.id && <VersionPanels job={viewed} />}
        </div>
      )}

      {/* History / rollback */}
      {status && status.jobs.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">History</p>
          <ul className="space-y-1.5">
            {status.jobs.slice(0, 6).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      j.status === "published" && "bg-emerald-500",
                      j.status === "error" && "bg-red-500",
                      j.status === "rejected" && "bg-muted-foreground",
                      j.status === "awaiting_review" && "bg-blue-500",
                      (j.status === "running" || j.status === "pending") && "bg-amber-500"
                    )}
                  />
                  <span className="capitalize">{j.status.replace("_", " ")}</span>
                  <span className="text-muted-foreground">{new Date(j.createdAt).toLocaleString()}</span>
                  {j.status === "error" && j.errorMessage && (
                    <span className="text-red-600 dark:text-red-400">— {j.errorMessage.slice(0, 80)}</span>
                  )}
                </span>
                {j.status === "published" && (
                  <button
                    type="button"
                    onClick={() => restore(j.id)}
                    disabled={!canManage}
                    className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Earlier live prompts — what each publish or restore replaced */}
      {status && status.snapshots.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Earlier live prompts</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Saved automatically whenever a publish or restore replaced the live prompts.
          </p>
          <ul className="space-y-1.5">
            {status.snapshots.map((s) => (
              <li key={s.id} className="text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span>{s.wasPlaceholder ? "Generic placeholder prompts" : "Brand-specific prompts"}</span>
                    <span className="text-muted-foreground">
                      {s.liveSince ? `live ${new Date(s.liveSince).toLocaleDateString()} – ` : "replaced "}
                      {new Date(s.replacedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleView(s.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {viewed?.id === s.id ? "Hide" : "View"}
                    </button>
                    <button
                      type="button"
                      onClick={() => restore(s.id)}
                      disabled={!canManage}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </button>
                  </span>
                </div>
                {viewed?.id === s.id && <VersionPanels job={viewed} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function VersionPanels({ job }: { job: JobDetail }) {
  return (
    <div className="mt-3 space-y-2">
      {job.brandDna?.document && <Panel title="Brand DNA" text={job.brandDna.document} />}
      {job.agent1Prompt && <Panel title="Agent 1" text={job.agent1Prompt} />}
      {job.agent2Prompt && <Panel title="Agent 2" text={job.agent2Prompt} />}
    </div>
  );
}

function Panel({ title, text }: { title: string; text: string }) {
  return (
    <details className="rounded-lg border border-border bg-background">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">{title}</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {text}
      </pre>
    </details>
  );
}
