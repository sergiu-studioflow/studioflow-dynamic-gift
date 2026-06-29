"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Quote, Loader2, Check, X, Pencil, Download, Star, ImageIcon, AlertCircle, Save, Expand,
  Copy, Instagram, Facebook, RectangleVertical, Megaphone,
} from "lucide-react";
import { useClient } from "@/lib/client-context";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/review-graphics/lightbox";

type Asset = {
  id: string;
  format: string;
  aspectRatio: string;
  status: string;
  errorMessage: string | null;
  imageUrl: string | null;
};

type Graphic = {
  id: string;
  status: string;
  reviewerName: string | null;
  reviewText: string | null;
  stars: number | null;
  pullQuote: string | null;
  instagramCaption: string | null;
  storiesCaption: string | null;
  facebookCaption: string | null;
  cta: string | null;
  hashtags: string[] | null;
  assets: Asset[];
};

const STATUS_TABS = [
  { key: "draft", label: "Draft" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const FORMAT_META: Record<string, { label: string; icon: typeof Instagram; aspect: string }> = {
  ig_feed: { label: "IG Feed", icon: Instagram, aspect: "aspect-[4/5]" },
  story: { label: "Story", icon: RectangleVertical, aspect: "aspect-[9/16]" },
  fb: { label: "Facebook", icon: Facebook, aspect: "aspect-square" },
};

function downloadAsset(asset: Asset, graphic: Graphic) {
  if (!asset.imageUrl) return;
  const name = `${(graphic.reviewerName || "review").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${asset.format}.png`;
  const href = `/api/static-ads/download?url=${encodeURIComponent(asset.imageUrl)}&filename=${encodeURIComponent(name)}`;
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ReviewGallery({ refreshTrigger }: { refreshTrigger: number }) {
  const { clientId } = useClient();
  const [status, setStatus] = useState("draft");
  const [graphics, setGraphics] = useState<Graphic[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/review-graphics?clientId=${clientId}&status=${status}`);
      const data = await res.json();
      if (Array.isArray(data)) setGraphics(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [clientId, status]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, refreshTrigger]);

  // Poll while anything is still generating
  useEffect(() => {
    const inflight =
      graphics.some((g) => g.status === "generating") ||
      graphics.some((g) => g.assets.some((a) => a.status === "generating"));
    if (pollRef.current) clearTimeout(pollRef.current);
    if (inflight) {
      pollRef.current = setTimeout(load, 5000);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [graphics, load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status filter — segmented control */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-all",
                status === t.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {graphics.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {graphics.length} {status === "all" ? "" : status} set{graphics.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {graphics.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-muted-foreground/40">
          <Quote className="mb-3 h-12 w-12" />
          <p className="text-sm">No {status === "all" ? "" : status} review graphics yet</p>
          <p className="text-[11px] text-muted-foreground/30">Generate some from the Reviews or Generate tab</p>
        </div>
      ) : (
        <div className="space-y-6">
          {graphics.map((g) => (
            <GraphicCard key={g.id} graphic={g} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function GraphicCard({ graphic, onChanged }: { graphic: Graphic; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    pullQuote: graphic.pullQuote || "",
    instagramCaption: graphic.instagramCaption || "",
    storiesCaption: graphic.storiesCaption || "",
    facebookCaption: graphic.facebookCaption || "",
    cta: graphic.cta || "",
    hashtags: (graphic.hashtags || []).join(", "),
  });
  const [lightbox, setLightbox] = useState<{ images: string[]; start: number } | null>(null);

  const completedImages = graphic.assets
    .filter((a) => a.status === "completed" && a.imageUrl)
    .map((a) => a.imageUrl as string);
  const isGenerating = graphic.assets.some((a) => a.status === "generating");

  async function act(body: object) {
    setBusy(true);
    try {
      const res = await fetch(`/api/review-graphics/${graphic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveCaptions() {
    await act({
      captions: {
        pullQuote: form.pullQuote,
        instagramCaption: form.instagramCaption,
        storiesCaption: form.storiesCaption,
        facebookCaption: form.facebookCaption,
        cta: form.cta,
        hashtags: form.hashtags.split(",").map((h) => h.trim()).filter(Boolean),
      },
    });
    setEditing(false);
  }

  const initial = (graphic.reviewerName || "?").trim().charAt(0).toUpperCase();

  return (
    <article className="group/card relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
      {/* top hairline accent */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border/60 px-5 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{graphic.reviewerName || "Anonymous"}</span>
            {graphic.stars != null && (
              <span className="flex shrink-0 items-center gap-0.5">
                {Array.from({ length: graphic.stars }).map((_, i) => (
                  <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                ))}
              </span>
            )}
          </div>
          {graphic.reviewText && (
            <p className="truncate text-[11px] italic text-muted-foreground/70">&ldquo;{graphic.reviewText}&rdquo;</p>
          )}
        </div>
        <StatusPill status={graphic.status} />
      </header>

      {/* Body */}
      <div className="grid gap-6 p-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* Preview rail — the hero */}
        <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
          {graphic.assets.map((a) => {
            const meta = FORMAT_META[a.format] || { label: a.format, icon: ImageIcon, aspect: "aspect-square" };
            const Icon = meta.icon;
            const clickable = a.status === "completed" && a.imageUrl;
            return (
              <div key={a.id} className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    clickable && setLightbox({ images: completedImages, start: Math.max(0, completedImages.indexOf(a.imageUrl as string)) })
                  }
                  className={cn(
                    "group/thumb relative h-60 overflow-hidden rounded-xl border border-border bg-muted shadow-md ring-1 ring-black/20 transition-all",
                    meta.aspect,
                    clickable ? "cursor-zoom-in hover:-translate-y-0.5 hover:shadow-xl hover:ring-primary/30" : "cursor-default"
                  )}
                >
                  {a.status === "generating" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/60">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-[10px]">generating…</span>
                    </div>
                  ) : a.status === "error" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center text-red-400">
                      <AlertCircle className="h-5 w-5" />
                      <span className="text-[9px]">failed</span>
                    </div>
                  ) : a.imageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.imageUrl} alt={meta.label} className="h-full w-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover/thumb:bg-black/35 group-hover/thumb:opacity-100">
                        <Expand className="h-5 w-5 text-white" />
                      </span>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                </button>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                  {clickable && (
                    <button
                      onClick={() => downloadAsset(a, graphic)}
                      className="ml-1 text-muted-foreground/50 transition-colors hover:text-primary"
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Caption panel */}
        {editing ? (
          <div className="space-y-2">
            <EditField label="Pull quote" value={form.pullQuote} onChange={(v) => setForm({ ...form, pullQuote: v })} />
            <EditField label="Instagram caption" value={form.instagramCaption} onChange={(v) => setForm({ ...form, instagramCaption: v })} multiline />
            <EditField label="Story caption" value={form.storiesCaption} onChange={(v) => setForm({ ...form, storiesCaption: v })} multiline />
            <EditField label="Facebook caption" value={form.facebookCaption} onChange={(v) => setForm({ ...form, facebookCaption: v })} multiline />
            <EditField label="CTA" value={form.cta} onChange={(v) => setForm({ ...form, cta: v })} />
            <EditField label="Hashtags (comma separated)" value={form.hashtags} onChange={(v) => setForm({ ...form, hashtags: v })} />
          </div>
        ) : isGenerating && !graphic.pullQuote ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground/50">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Writing captions…
          </div>
        ) : (
          <CaptionPanel graphic={graphic} />
        )}
      </div>

      {/* Footer actions */}
      <footer className="flex items-center gap-2 border-t border-border/60 bg-background/40 px-5 py-3">
        {editing ? (
          <>
            <button
              onClick={saveCaptions}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-all hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save copy
            </button>
            <GhostBtn onClick={() => setEditing(false)} disabled={busy} icon={X} label="Cancel" />
          </>
        ) : (
          <>
            {graphic.status !== "approved" && (
              <button
                onClick={() => act({ action: "approve" })}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-emerald-600 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
              </button>
            )}
            {graphic.status !== "rejected" && (
              <GhostBtn onClick={() => act({ action: "reject" })} disabled={busy} icon={X} label="Reject" danger />
            )}
            <GhostBtn onClick={() => setEditing(true)} disabled={busy} icon={Pencil} label="Edit copy" />
          </>
        )}
      </footer>

      {lightbox && <Lightbox images={lightbox.images} start={lightbox.start} onClose={() => setLightbox(null)} />}
    </article>
  );
}

const PLATFORMS = [
  { key: "instagram", label: "Instagram", icon: Instagram, get: (g: Graphic) => g.instagramCaption },
  { key: "story", label: "Story", icon: RectangleVertical, get: (g: Graphic) => g.storiesCaption },
  { key: "facebook", label: "Facebook", icon: Facebook, get: (g: Graphic) => g.facebookCaption },
] as const;

function CaptionPanel({ graphic }: { graphic: Graphic }) {
  const [tab, setTab] = useState<(typeof PLATFORMS)[number]["key"]>("instagram");
  const active = PLATFORMS.find((p) => p.key === tab)!;
  const caption = active.get(graphic) || "";
  const hashtags = graphic.hashtags || [];
  const hashtagStr = hashtags.map((h) => `#${h}`).join(" ");

  return (
    <div className="flex flex-col gap-3">
      {/* Pull quote — the headline */}
      {graphic.pullQuote && (
        <div className="relative rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <Quote className="absolute left-3 top-2.5 h-4 w-4 text-primary/40" />
          <p className="pl-5 text-[15px] font-semibold leading-snug text-foreground">{graphic.pullQuote}</p>
        </div>
      )}

      {/* Platform segmented tabs */}
      <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted/50 p-0.5">
        {PLATFORMS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.key}
              onClick={() => setTab(p.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all",
                tab === p.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Selected caption */}
      <div className="relative rounded-lg border border-border bg-background/40 p-3">
        <div className="absolute right-2 top-2">
          <CopyButton text={caption} />
        </div>
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap pr-14 text-[12.5px] leading-relaxed text-muted-foreground">
          {caption || <span className="italic text-muted-foreground/50">No {active.label} caption</span>}
        </p>
      </div>

      {/* CTA + hashtags */}
      <div className="flex flex-wrap items-center gap-2">
        {graphic.cta && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
            <Megaphone className="h-3 w-3" />
            {graphic.cta}
          </span>
        )}
      </div>

      {hashtags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {hashtags.map((h) => (
            <span key={h} className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              #{h}
            </span>
          ))}
          <CopyButton text={hashtagStr} label="Copy all" className="ml-1" />
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        copied ? "bg-emerald-500/10 text-emerald-400" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { dot: string; text: string; bg: string }> = {
    draft: { dot: "bg-blue-400", text: "text-blue-400", bg: "bg-blue-500/10" },
    approved: { dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-500/10" },
    rejected: { dot: "bg-red-400", text: "text-red-400", bg: "bg-red-500/10" },
    generating: { dot: "bg-amber-400 animate-pulse", text: "text-amber-400", bg: "bg-amber-500/10" },
    error: { dot: "bg-red-400", text: "text-red-400", bg: "bg-red-500/10" },
  };
  const s = map[status] || { dot: "bg-muted-foreground", text: "text-muted-foreground", bg: "bg-muted" };
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide", s.bg, s.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {status}
    </span>
  );
}

function GhostBtn({
  onClick, disabled, icon: Icon, label, danger,
}: { onClick: () => void; disabled?: boolean; icon: React.ComponentType<{ className?: string }>; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-all disabled:opacity-50",
        danger ? "text-muted-foreground hover:border-red-500/40 hover:text-red-400" : "text-muted-foreground hover:text-foreground hover:border-primary/30"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EditField({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground focus:border-primary focus:outline-none"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground focus:border-primary focus:outline-none"
        />
      )}
    </label>
  );
}
