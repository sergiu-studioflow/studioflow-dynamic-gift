"use client";

import { useEffect, useState } from "react";

/** A brief still "generating" after this long never got its n8n callback; treat it as stalled. */
export const BRIEF_STALE_MS = 30 * 60 * 1000;

type BriefSummary = { id: string; status: string; createdAt: string };

/**
 * "Generate Brief" state for one competitor ad / organic post. Looks up a brief
 * already generated (or still generating) for that source, so reopening the
 * modal links to it instead of paying for another, and reports generation
 * errors instead of silently resetting the button.
 */
export function useSourceBrief(
  sourceType: "competitor_ad" | "organic_post",
  sourceId: number,
  clientId: string | null
) {
  const key = clientId ? `${clientId}:${sourceType}:${sourceId}` : null;
  const [lookup, setLookup] = useState<{ key: string; briefId: string | null } | null>(null);
  const [created, setCreated] = useState<{ key: string; briefId: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    const lookupKey = `${clientId}:${sourceType}:${sourceId}`;
    let cancelled = false;
    const params = new URLSearchParams({ clientId, sourceType, sourceId: String(sourceId) });
    fetch(`/api/research-briefs?${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: unknown) => {
        if (cancelled) return;
        const briefs = Array.isArray(rows) ? (rows as BriefSummary[]) : [];
        // Newest first. Reuse a finished or still-running brief; failed or stalled ones can be retried.
        const usable = briefs.find(
          (b) =>
            b.status === "complete" ||
            (b.status === "generating" && Date.now() - new Date(b.createdAt).getTime() < BRIEF_STALE_MS)
        );
        setLookup({ key: lookupKey, briefId: usable?.id ?? null });
      })
      .catch(() => {
        // Lookup failed — allow generating; the API still refuses a duplicate in-flight brief.
        if (!cancelled) setLookup({ key: lookupKey, briefId: null });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, sourceType, sourceId]);

  const checking = key !== null && lookup?.key !== key;
  const briefId =
    (created && created.key === key ? created.briefId : null) ??
    (lookup && lookup.key === key ? lookup.briefId : null);

  async function generate() {
    if (!clientId || !key || generating || checking || briefId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/research-briefs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, sourceId, clientId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.briefId === "string") {
        setCreated({ key, briefId: data.briefId });
      } else {
        setError(data.error || `Brief generation failed (HTTP ${res.status}).`);
      }
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  return { briefId, checking, generating, error, generate };
}
