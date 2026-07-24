"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Zap, X, Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/client-context";
import { PostCard } from "./post-card";
import type { ScheduledPost } from "./types";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheduling, setScheduling] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualAt, setManualAt] = useState("");

  const load = useCallback(async () => {
    if (!clientId) {
      setPosts([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/posting/posts?clientId=${clientId}&status=${mode}`);
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  }, [clientId, mode]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh while anything is mid-flight.
  useEffect(() => {
    const active = posts.some((p) => ["generating", "publishing"].includes(p.status));
    if (!active) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [posts, load]);

  const selectable = useMemo(() => posts.filter((p) => ["draft", "scheduled"].includes(p.status)), [posts]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulkSchedule(kind: "auto" | "manual") {
    if (!clientId || selected.size === 0) return;
    if (kind === "manual" && !manualAt) return;
    setScheduling(true);
    try {
      const res = await fetch("/api/posting/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          postIds: [...selected],
          mode: kind,
          scheduledAt: kind === "manual" ? new Date(manualAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Scheduling failed");
      } else {
        setSelected(new Set());
        setShowManual(false);
        setManualAt("");
        await load();
      }
    } finally {
      setScheduling(false);
    }
  }

  if (isAllClients) {
    return <Empty text="Select a brand from the switcher to see its queue." />;
  }

  return (
    <div className="space-y-4">
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
              <span className="text-xs text-muted-foreground">brand-local time</span>
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
            />
          ))}
        </div>
      )}
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
