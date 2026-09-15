"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Zap, X, Loader2, Inbox, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/client-context";
import { PostCard } from "./post-card";
import type { PostingHealth, ScheduledPost } from "./types";

/** A queue entry still 'generating' after this long lost its request — stop polling for it. */
const GENERATING_POLL_WINDOW_MS = 3 * 60_000;

function fmtSchedule(iso: string, tz: string): string {
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

export function PostingQueue({ mode }: { mode: "queue" | "history" }) {
  const { clientId, isAllClients } = useClient();
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [health, setHealth] = useState<PostingHealth | null>(null);
  // When the list was last loaded; drives the overdue / stuck markers without impure renders.
  const [loadedAt, setLoadedAt] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheduling, setScheduling] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualAt, setManualAt] = useState("");

  const load = useCallback(async () => {
    if (!clientId) {
      setPosts([]);
      setHealth(null);
      return;
    }
    setLoading(true);
    try {
      const [res, hRes] = await Promise.all([
        fetch(`/api/posting/posts?clientId=${clientId}&status=${mode}`),
        fetch(`/api/posting/health?clientId=${clientId}`),
      ]);
      if (res.ok) {
        setPosts(await res.json());
        setLoadedAt(Date.now());
        setLoadError("");
      } else {
        setLoadError("Couldn't load posts — refresh to try again.");
      }
      if (hRes.ok) setHealth(await hRes.json());
    } catch {
      setLoadError("Couldn't load posts — check your connection.");
    } finally {
      setLoading(false);
    }
  }, [clientId, mode]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while something is mid-flight: quickly for a fresh queue entry, slowly while
  // publishing (the publisher runs every 30 minutes). A stale 'generating' row is not polled.
  useEffect(() => {
    const now = Date.now();
    const generating = posts.some((p) => p.status === "generating" && now - new Date(p.createdAt).getTime() < GENERATING_POLL_WINDOW_MS);
    const publishing = posts.some((p) => p.status === "publishing");
    if (!generating && !publishing) return;
    const t = setInterval(load, generating ? 8000 : 60000);
    return () => clearInterval(t);
  }, [posts, load]);

  const selectable = useMemo(() => posts.filter((p) => ["draft", "scheduled"].includes(p.status)), [posts]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkSchedule(kind: "auto" | "manual") {
    if (!clientId || selected.size === 0) return;
    if (kind === "manual" && !manualAt) return;
    if (
      kind === "auto" &&
      !confirm(
        `Approve and auto-schedule ${selected.size} post${selected.size > 1 ? "s" : ""} into the next free slots? They will publish to Facebook/Instagram automatically at those times.`
      )
    ) {
      return;
    }
    setScheduling(true);
    try {
      const res = await fetch("/api/posting/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          postIds: [...selected],
          mode: kind,
          // Wall-clock time in the brand's timezone — converted on the server.
          scheduledLocal: kind === "manual" ? manualAt : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Scheduling failed");
      } else {
        setSelected(new Set());
        setShowManual(false);
        setManualAt("");
        await load();
      }
    } catch {
      alert("Scheduling failed — check your connection.");
    } finally {
      setScheduling(false);
    }
  }

  if (isAllClients) {
    return <Empty text="Select a brand from the switcher to see its queue." />;
  }

  return (
    <div className="space-y-4">
      {health && <HealthBanner health={health} />}
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}

      {mode === "queue" && selectable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <button
            onClick={() => setSelected(new Set(selectable.map((p) => p.id)))}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            select all ({selectable.length})
          </button>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              clear
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => bulkSchedule("auto")} disabled={selected.size === 0 || scheduling}>
              {scheduling ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1 h-3.5 w-3.5" />}
              Approve & Auto-slot
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowManual((v) => !v)} disabled={selected.size === 0}>
              <CalendarClock className="mr-1 h-3.5 w-3.5" /> Schedule…
            </Button>
          </div>
          {showManual && (
            <div className="flex w-full items-center gap-2 pt-2">
              <input
                type="datetime-local"
                value={manualAt}
                onChange={(e) => setManualAt(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted-foreground">{health ? `${health.timezone} time` : "brand-local time"}</span>
              <Button size="sm" onClick={() => bulkSchedule("manual")} disabled={!manualAt || scheduling}>
                Confirm
              </Button>
              <button onClick={() => setShowManual(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {loading && posts.length === 0 ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <Empty
          text={mode === "queue" ? "Nothing queued yet. Send a static ad, winner, or approved review graphic to the queue." : "No published or failed posts yet."}
        />
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              selected={selected.has(p.id)}
              onToggleSelect={toggle}
              onChanged={load}
              fmtSchedule={fmtSchedule}
              now={loadedAt}
              overdueMinutes={health?.overdueMinutes ?? 45}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Explains, before anything is overdue, why scheduled posts would not go out. */
function HealthBanner({ health }: { health: PostingHealth }) {
  const problems: string[] = [];
  if (!health.tokenConfigured) {
    problems.push("The Meta System User token isn't configured (Settings → API Keys) — scheduled posts cannot publish until it is added.");
  }
  const enabled = health.accounts.filter((a) => a.enabled);
  if (enabled.length === 0) {
    problems.push("No Facebook or Instagram account is connected for this brand — connect one under Accounts.");
  }
  for (const a of enabled) {
    if (a.health === "token_invalid" || a.health === "error") {
      const label = a.platform === "instagram" ? "Instagram" : "Facebook";
      problems.push(`${label}${a.externalName ? ` (${a.externalName})` : ""}: ${a.healthError || "the last connection test failed"} — re-test it under Accounts.`);
    }
  }
  if (health.overdueCount > 0) {
    problems.push(
      `${health.overdueCount} scheduled post${health.overdueCount > 1 ? "s are" : " is"} more than ${health.overdueMinutes} minutes past due and not published yet.`
    );
  }
  if (!problems.length) return null;

  return (
    <div className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
      {problems.map((p) => (
        <p key={p} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p}
        </p>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
      <Inbox className="h-6 w-6" />
      <p className="max-w-sm">{text}</p>
    </div>
  );
}
