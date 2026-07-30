"use client";

/**
 * Static-Ad Prompt Builder panel.
 *
 * A brand can't produce static ads until it has a brand-specific Agent 1 and
 * Agent 2 prompt. This runs the research pipeline that drafts them, shows the
 * draft, and publishes only on explicit approval — the Agent 1/2 prompts are
 * FIXED per brand, so a reviewed publish is the only way they ever change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, RotateCcw, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type JobSummary = {
  id: string;
  status: string;
  stage: string | null;
  errorMessage: string | null;
  createdAt: string;
  publishedAt: string | null;
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

export function ClientStaticAdPrompts({ clientSlug }: { clientSlug: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [brandType, setBrandType] = useState<"products" | "services">("products");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobDetail | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDetail = useCallback(
    async (jobId: string) => {
      const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts/${jobId}`);
      if (res.ok) setActiveJob(await res.json());
    },
    [clientSlug]
  );

  const loadStatus = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientSlug}/static-ad-prompts`);
    if (!res.ok) return;
    const data: Status = await res.json();
    setStatus(data);
    setBrandType(data.brandType);
    const latest = data.jobs[0];
    if (latest && (latest.status === "running" || latest.status === "pending")) {
      setActiveJobId(latest.id);
    } else if (latest && latest.status === "awaiting_review") {
      loadDetail(latest.id);
    }
  }, [clientSlug, loadDetail]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

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
    if (action === "approve" && !confirm("Publish these prompts live for this brand?")) return;
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
    loadStatus();
  }

  async function restore(jobId: string) {
    if (!confirm("Restore this brand's live prompts to this version?")) return;
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
            Researches the brand — site, guidelines, brand intel, product images — and drafts the two prompts
            that drive every static ad it produces. Review the draft, then publish. Nothing goes live until you
            approve it, and every published version can be restored.
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
                : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
            )}
          >
            {status.hasGuidelines ? (
              <>High-accuracy mode: Brand Guidelines are filled and used as the source of truth.</>
            ) : (
              <>
                Research-only draft — filling this brand&rsquo;s <span className="font-medium">Brand Guidelines</span>{" "}
                (colours, fonts, voice) first produces markedly more on-brand prompts. You can re-generate any time.
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
              disabled={running}
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
          disabled={running}
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
              disabled={busy}
              onClick={() => review(activeJob.id, "approve")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Approve &amp; Publish
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => review(activeJob.id, "reject")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Reject
            </button>
          </div>
        </div>
      )}

      {/* Last published — inspect what is currently live */}
      {lastPublished && !running && !inReview && (
        <div className="mt-4">
          <button
            type="button"
            onClick={async () => {
              if (activeJob?.id !== lastPublished.id) await loadDetail(lastPublished.id);
              else setActiveJob(null);
            }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {activeJob?.id === lastPublished.id ? "Hide" : "View"} live Brand DNA + prompts
          </button>
          {activeJob?.id === lastPublished.id && (
            <div className="mt-3 space-y-2">
              {activeJob.brandDna?.document && <Panel title="Brand DNA" text={activeJob.brandDna.document} />}
              {activeJob.agent1Prompt && <Panel title="Agent 1" text={activeJob.agent1Prompt} />}
              {activeJob.agent2Prompt && <Panel title="Agent 2" text={activeJob.agent2Prompt} />}
            </div>
          )}
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
                    className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
