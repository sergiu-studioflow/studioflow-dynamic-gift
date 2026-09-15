"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClient } from "@/lib/client-context";
import { useQcAutoGrade } from "@/components/qc/review-scorecard";

// A run with no result after this long is treated as stuck and offered Retry. Kept in step with
// STUCK_AFTER_MS in the /trigger routes, which refuse to restart a younger in-flight run.
export const STUCK_AFTER_MS = 20 * 60_000;

const ACTIVE_POLL_MS = 5_000;
const STUCK_POLL_MS = 60_000;

type RequestBase = { id: string; status: string; updatedAt: Date | string; errorMessage: string | null };
type ChildBase = { id: string; qcStatus?: string | null; qcReviewId?: string | null };

type Options = {
  /** e.g. "/api/ideation" */
  apiBase: string;
  /** Key holding the generated rows in GET {apiBase}/[id]: "ideas" | "concepts" | "briefs". */
  childKey: string;
  /** Statuses of a request that is queued or generating. The first is what a restart sets. */
  inFlightStatuses: readonly string[];
  /** Plural noun for messages: "ideas", "concepts", "briefs". */
  childNoun: string;
};

/**
 * State for the three text-generation libraries (Content Ideation, Ad Copy, Video Brief):
 * brand-scoped request list with polling, the expanded request's generated rows (refetched
 * whenever that request changes), Quality Control held rows, and Retry / Re-generate / Delete.
 *
 * Mount the library with key={clientId} so a brand switch starts from a clean slate.
 */
export function useRequestLibrary<R extends RequestBase, C extends ChildBase>({
  apiBase,
  childKey,
  inFlightStatuses,
  childNoun,
}: Options) {
  const { clientId, clientName, isReady } = useClient();
  // ?request=<id> (the QC queue links here) opens that request with its held rows showing.
  const focusRequestId = useSearchParams().get("request");

  const [requests, setRequests] = useState<R[]>([]);
  const [checkedAt, setCheckedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [children, setChildren] = useState<C[]>([]);
  // Which request (and view) `children` belongs to — rows are never shown under another request.
  const [childrenFor, setChildrenFor] = useState<string | null>(null);
  const [heldCount, setHeldCount] = useState(0);
  const [childrenError, setChildrenError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Overlapping polls: only the newest response may write state.
  const listSeq = useRef(0);
  const childSeq = useRef(0);
  const focusApplied = useRef<string | null>(null);

  const isInFlight = useCallback((status: string) => inFlightStatuses.includes(status), [inFlightStatuses]);

  const loadRequests = useCallback(async () => {
    const seq = ++listSeq.current;
    try {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
      const res = await fetch(`${apiBase}${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: R[] = await res.json();
      if (seq !== listSeq.current) return;
      setRequests(data);
      setCheckedAt(Date.now());
      setError(null);
      if (focusRequestId && focusApplied.current !== focusRequestId && data.some((r) => r.id === focusRequestId)) {
        focusApplied.current = focusRequestId;
        setExpandedId(focusRequestId);
        setShowHeld(true);
      }
    } catch {
      if (seq !== listSeq.current) return;
      setError("Couldn't load requests. Check your connection and use Refresh to try again.");
    } finally {
      if (seq === listSeq.current) setLoading(false);
    }
  }, [apiBase, clientId, focusRequestId]);

  const loadChildren = useCallback(
    (requestId: string, includeHeld: boolean) => {
      const seq = ++childSeq.current;
      const view = `${requestId}:${includeHeld}`;
      return fetch(`${apiBase}/${requestId}${includeHeld ? "?qc=all" : ""}`, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (seq !== childSeq.current) return;
          setChildren(Array.isArray(data[childKey]) ? data[childKey] : []);
          setHeldCount(typeof data.heldCount === "number" ? data.heldCount : 0);
          setChildrenFor(view);
          setChildrenError(null);
        })
        .catch(() => {
          if (seq !== childSeq.current) return;
          setChildrenError(`Couldn't load the ${childNoun}. Use Refresh to try again.`);
          setChildrenFor(view);
        });
    },
    [apiBase, childKey, childNoun]
  );

  // Initial load, once the brand selection has settled (no flash of every brand's requests).
  useEffect(() => {
    if (!isReady) return;
    loadRequests();
  }, [isReady, loadRequests]);

  const isStuck = useCallback(
    (req: R) => isInFlight(req.status) && checkedAt - new Date(req.updatedAt).getTime() > STUCK_AFTER_MS,
    [checkedAt, isInFlight]
  );

  // Poll while a run is in flight; slowly for runs that look stuck (they may still finish).
  const hasActive = requests.some((r) => isInFlight(r.status) && !isStuck(r));
  const hasStuck = requests.some((r) => isStuck(r));
  const pollMs = hasActive ? ACTIVE_POLL_MS : hasStuck ? STUCK_POLL_MS : 0;
  useEffect(() => {
    if (!pollMs) return;
    const interval = setInterval(loadRequests, pollMs);
    return () => clearInterval(interval);
  }, [pollMs, loadRequests]);

  // Refetch the expanded request's rows whenever that request changes (processing → complete,
  // a restart…) or the held toggle flips. Loading them once on expand is what left a finished
  // run reading "No ideas generated yet".
  const expanded = requests.find((r) => r.id === expandedId);
  const expandedVersion = expanded ? `${expanded.id}|${expanded.status}|${String(expanded.updatedAt)}` : null;
  useEffect(() => {
    if (!expandedId || !expandedVersion) return;
    loadChildren(expandedId, showHeld);
  }, [expandedId, expandedVersion, showHeld, loadChildren]);

  // Verdicts land while the rows are open (the static/video galleries do the same). Only rows
  // actually queued for grading count — older rows that never were would pump forever.
  useQcAutoGrade(
    !!expandedId && children.some((c) => c.qcStatus === "pending" && !!c.qcReviewId),
    () => {
      if (expandedId) loadChildren(expandedId, showHeld);
    }
  );

  const childrenReady = !!expandedId && childrenFor === `${expandedId}:${showHeld}`;

  function toggleExpand(requestId: string) {
    setShowHeld(false);
    setExpandedId((current) => (current === requestId ? null : requestId));
  }

  function refresh() {
    loadRequests();
    if (expandedId) loadChildren(expandedId, showHeld);
  }

  async function retrigger(req: R) {
    const post = (confirm: boolean) =>
      fetch(`${apiBase}/${req.id}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });

    setBusyId(req.id);
    try {
      let res = await post(false);
      let data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === "confirm_required") {
        const n = Number(data.existingCount) || 0;
        const ok = window.confirm(
          `Re-generate this request?\n\nThis permanently deletes its ${n} generated ${n === 1 ? childNoun.replace(/s$/, "") : childNoun} ` +
            `— including any you've approved or saved — and runs the AI again, which takes a few minutes and uses paid credits.`
        );
        if (!ok) return;
        res = await post(true);
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        window.alert(data.error || "Couldn't restart this request.");
        loadRequests();
        return;
      }
      const status: string = data.status || inFlightStatuses[0];
      setRequests((prev) =>
        prev.map((r) =>
          r.id === req.id ? { ...r, status, errorMessage: data.errorMessage ?? null, updatedAt: new Date().toISOString() } : r
        )
      );
      if (data.errorMessage) window.alert(data.errorMessage);
      loadRequests();
    } catch {
      window.alert("Network error — the request was not restarted.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(req: R) {
    if (!window.confirm(`Delete this request and all its ${childNoun}? This can't be undone.`)) return;
    setBusyId(req.id);
    try {
      const res = await fetch(`${apiBase}/${req.id}`, { method: "DELETE" });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== req.id));
        if (expandedId === req.id) setExpandedId(null);
      } else {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error || "Couldn't delete this request.");
      }
    } catch {
      window.alert("Network error — the request was not deleted.");
    } finally {
      setBusyId(null);
    }
  }

  function updateChild(childId: string, patch: Partial<C>) {
    setChildren((prev) => prev.map((c) => (c.id === childId ? { ...c, ...patch } : c)));
  }

  return {
    clientId,
    clientName,
    requests,
    loading,
    error,
    refresh,
    expandedId,
    toggleExpand,
    children,
    childrenReady,
    childrenError,
    heldCount,
    showHeld,
    toggleShowHeld: () => setShowHeld((v) => !v),
    updateChild,
    busyId,
    retrigger,
    remove,
    isInFlight: (req: R) => isInFlight(req.status),
    isStuck,
    /** Re-generate a finished/failed run, or retry one that is stuck. */
    canRetry: (req: R) => req.status === "error" || req.status === "complete" || isStuck(req),
  };
}
