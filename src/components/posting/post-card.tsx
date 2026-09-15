"use client";

import { useState } from "react";
import Image from "next/image";
import { Instagram, Facebook, AlertTriangle, CheckCircle2, Clock, RefreshCw, ExternalLink, Undo2, Ban, Trash2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScheduledPost, PostTarget } from "./types";

const PLATFORM_CAPS: Record<string, { ideal: number; hard: number }> = {
  instagram: { ideal: 300, hard: 2200 },
  facebook: { ideal: 500, hard: 3000 },
};

const STATUS_STYLE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }> = {
  generating: { label: "Generating…", variant: "secondary" },
  draft: { label: "Draft", variant: "outline" },
  scheduled: { label: "Scheduled", variant: "default" },
  publishing: { label: "Publishing…", variant: "secondary" },
  published: { label: "Published", variant: "success" },
  partial: { label: "Partly published", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

/** Matches the API: a queue entry still 'generating' after this long can be deleted. */
const STALE_GENERATING_MS = 5 * 60_000;

function PlatformIcon({ platform }: { platform: string }) {
  return platform === "instagram" ? <Instagram className="h-4 w-4" /> : <Facebook className="h-4 w-4" />;
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export function PostCard({
  post,
  selected,
  onToggleSelect,
  onChanged,
  fmtSchedule,
  now,
  overdueMinutes,
}: {
  post: ScheduledPost;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onChanged: () => void;
  fmtSchedule: (iso: string, tz: string) => string;
  /** When the list was loaded (ms) — keeps render pure. */
  now: number;
  overdueMinutes: number;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const editable = post.status === "draft";
  const s = STATUS_STYLE[post.status] || STATUS_STYLE.draft;
  const name = String(post.sourceSnapshot?.name || post.sourceType);

  // Nothing has gone out and nothing is in flight or unresolved.
  const untouched = post.targets.every((t) => ["pending", "failed", "skipped"].includes(t.status) && t.errorCode !== "ambiguous_stuck");
  const staleGenerating = post.status === "generating" && now - new Date(post.createdAt).getTime() > STALE_GENERATING_MS;
  const canUnschedule = post.status === "scheduled" && untouched;
  const canCancel = (post.status === "scheduled" || post.status === "publishing") && untouched;
  const canDelete = (["draft", "cancelled", "failed"].includes(post.status) || staleGenerating) && untouched;
  const overdue =
    ["scheduled", "publishing"].includes(post.status) &&
    !!post.scheduledAt &&
    now - new Date(post.scheduledAt).getTime() > overdueMinutes * 60_000 &&
    post.targets.some((t) => t.enabled && t.status === "pending");

  async function run(kind: "unschedule" | "cancel" | "delete") {
    const prompts = {
      unschedule: "Unschedule this post? It goes back to Drafts and will not publish until it is scheduled again.",
      cancel: "Cancel this post? It will not publish, and moves to History.",
      delete: "Delete this post permanently? This cannot be undone.",
    };
    if (!confirm(prompts[kind])) return;
    setBusy(true);
    setActionError("");
    try {
      const res =
        kind === "delete"
          ? await fetch(`/api/posting/posts/${post.id}`, { method: "DELETE" })
          : await fetch(`/api/posting/posts/${post.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: kind }),
            });
      if (!res.ok) {
        setActionError(await errorFrom(res, `Could not ${kind} the post`));
        return;
      }
      onChanged();
    } catch {
      setActionError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("rounded-xl border bg-card p-4 transition-all", selected ? "border-primary ring-1 ring-primary/30" : "border-border")}>
      <div className="flex gap-4">
        {/* select + media */}
        <div className="flex flex-col items-center gap-2">
          {editable || post.status === "scheduled" ? (
            <input type="checkbox" checked={selected} onChange={() => onToggleSelect(post.id)} className="mt-1 h-4 w-4 accent-[var(--primary)]" />
          ) : null}
          <div className="relative h-28 w-28 overflow-hidden rounded-lg bg-muted">
            {post.mediaPreviewUrl ? (
              post.mediaType === "video" ? (
                <video src={post.mediaPreviewUrl} className="h-full w-full object-cover" muted />
              ) : (
                <Image src={post.mediaPreviewUrl} alt={name} fill className="object-cover" unoptimized />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">no preview</div>
            )}
          </div>
        </div>

        {/* body */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{name}</span>
            <Badge variant={staleGenerating ? "destructive" : s.variant} className="text-[10px]">
              {staleGenerating ? "Stuck generating" : s.label}
            </Badge>
            {overdue && <Badge variant="warning" className="text-[10px]">Overdue</Badge>}
            {post.angleTag && <Badge variant="outline" className="text-[10px]">{post.angleTag}</Badge>}
            {post.scheduledAt && (
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> {fmtSchedule(post.scheduledAt, post.timezone)}
              </span>
            )}
          </div>

          {(canUnschedule || canCancel || canDelete) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {canUnschedule && (
                <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => run("unschedule")} disabled={busy}>
                  <Undo2 className="mr-1 h-3 w-3" /> Unschedule
                </Button>
              )}
              {canCancel && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => run("cancel")} disabled={busy}>
                  <Ban className="mr-1 h-3 w-3" /> Cancel post
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive hover:text-destructive" onClick={() => run("delete")} disabled={busy}>
                  <Trash2 className="mr-1 h-3 w-3" /> Delete
                </Button>
              )}
              {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          )}
          {actionError && <p className="mb-2 text-[11px] text-destructive">{actionError}</p>}

          {post.errorMessage && (
            <div className="mb-2 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {post.errorMessage}
            </div>
          )}

          <div className="space-y-3">
            {post.targets.map((t) => (
              <TargetEditor key={t.id} post={post} target={t} editable={editable} onChanged={onChanged} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetEditor({ post, target, editable, onChanged }: { post: ScheduledPost; target: PostTarget; editable: boolean; onChanged: () => void }) {
  const [caption, setCaption] = useState(target.caption || "");
  const [tags, setTags] = useState((target.hashtags || []).join(" "));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const caps = PLATFORM_CAPS[target.platform] || { ideal: 400, hard: 2200 };
  const over = caption.length > caps.ideal;

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/posting/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "edit_target",
          targetId: target.id,
          caption,
          hashtags: tags.split(/[\s,]+/).map((h) => h.replace(/^#+/, "")).filter(Boolean),
        }),
      });
      if (!res.ok) {
        setError(await errorFrom(res, "Caption not saved"));
        return;
      }
      onChanged();
    } catch {
      setError("Caption not saved — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function patch(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/posting/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, targetId: target.id, ...extra }),
      });
      if (!res.ok) {
        setError(await errorFrom(res, "That didn't work — try again."));
        return;
      }
      onChanged();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const disabledLook = !target.enabled;

  return (
    <div className={cn("rounded-lg border border-border/60 p-2.5", disabledLook && "opacity-50")}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium capitalize">
        <PlatformIcon platform={target.platform} />
        {target.platform}
        <Badge variant="outline" className="text-[9px] uppercase">{target.placement}</Badge>
        <TargetStatusBadge target={target} />
        {editable && (
          <button
            onClick={() => patch("edit_target", { enabled: !target.enabled })}
            className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            disabled={busy}
          >
            {target.enabled ? "disable" : "enable"}
          </button>
        )}
        {target.externalPermalink && (
          <a href={target.externalPermalink} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-[11px] text-primary hover:underline">
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {editable ? (
        <>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={save}
            rows={3}
            placeholder="Caption…"
            className="w-full resize-none rounded-md border border-input bg-background p-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <div className="mt-1 flex items-center gap-2">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={save}
              placeholder="hashtags (space-separated, no #)"
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <span className={cn("text-[10px]", over ? "text-amber-500" : "text-muted-foreground")}>
              {caption.length}/{caps.ideal}
            </span>
            {saving && <span className="text-[10px] text-muted-foreground">saving…</span>}
          </div>
        </>
      ) : (
        <>
          {target.caption && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{target.caption}</p>}
          {!!target.hashtags?.length && (
            <p className="mt-1 text-[11px] text-primary/80">{target.hashtags.map((h) => `#${h}`).join(" ")}</p>
          )}
          {target.status === "pending" && target.errorMessage && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{target.errorMessage}</p>
          )}
          {target.status === "failed" && (
            <div className="mt-2 flex items-center gap-2">
              {target.errorMessage && <span className="text-[11px] text-destructive">{target.errorMessage}</span>}
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => patch("retry_target")} disabled={busy}>
                <RefreshCw className="mr-1 h-3 w-3" /> Retry
              </Button>
              {target.errorCode === "ambiguous_stuck" && (
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => patch("mark_published")} disabled={busy}>
                  Mark published
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function TargetStatusBadge({ target }: { target: PostTarget }) {
  if (target.status === "published") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (target.status === "failed") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (target.status === "publishing") return <Clock className="h-3.5 w-3.5 animate-pulse text-muted-foreground" />;
  return null;
}
