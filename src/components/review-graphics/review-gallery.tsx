"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Quote, Loader2, Check, X, Pencil, Download, Star, ImageIcon, AlertCircle, Save, Expand,
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

const FORMAT_LABELS: Record<string, string> = { ig_feed: "IG Feed", story: "Story", fb: "Facebook" };

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
    <div className="space-y-5">
      {/* Status filter */}
      <div className="flex items-center gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              status === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {graphics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
          <Quote className="h-12 w-12 mb-3" />
          <p className="text-sm">No {status === "all" ? "" : status} review graphics yet</p>
          <p className="text-[11px] text-muted-foreground/30">Generate some from the Generate tab</p>
        </div>
      ) : (
        <div className="space-y-5">
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

  // Completed graphic images (for the click-to-expand lightbox, in format order)
  const completedImages = graphic.assets.filter((a) => a.status === "completed" && a.imageUrl).map((a) => a.imageUrl as string);

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

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col lg:flex-row">
        {/* Images */}
        <div className="flex gap-3 p-4 lg:w-[58%] flex-wrap">
          {graphic.assets.map((a) => (
            <div key={a.id} className="flex flex-col gap-1.5">
              <div
                className={cn(
                  "relative overflow-hidden rounded-lg border border-border bg-muted",
                  a.format === "story" ? "w-[120px] h-[213px]" : a.format === "ig_feed" ? "w-[150px] h-[188px]" : "w-[180px] h-[180px]"
                )}
              >
                {a.status === "generating" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground/50">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-[10px]">generating</span>
                  </div>
                ) : a.status === "error" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-red-400 px-2 text-center">
                    <AlertCircle className="h-5 w-5" />
                    <span className="text-[9px]">failed</span>
                  </div>
                ) : a.imageUrl ? (
                  <button
                    type="button"
                    onClick={() => setLightbox({ images: completedImages, start: Math.max(0, completedImages.indexOf(a.imageUrl as string)) })}
                    className="group absolute inset-0 cursor-zoom-in"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.imageUrl} alt={a.format} className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                      <Expand className="h-5 w-5 text-white" />
                    </span>
                  </button>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/30">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground">{FORMAT_LABELS[a.format] || a.format}</span>
                {a.status === "completed" && a.imageUrl && (
                  <button onClick={() => downloadAsset(a, graphic)} className="text-muted-foreground/60 hover:text-foreground" title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Details */}
        <div className="flex-1 border-t lg:border-t-0 lg:border-l border-border p-4 space-y-3">
          {/* Source review */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{graphic.reviewerName || "Anonymous"}</span>
            {graphic.stars != null && (
              <span className="flex items-center gap-0.5">
                {Array.from({ length: graphic.stars }).map((_, i) => (
                  <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                ))}
              </span>
            )}
            <StatusBadge status={graphic.status} />
          </div>
          {graphic.reviewText && (
            <p className="text-[11px] text-muted-foreground/70 line-clamp-2 italic">&ldquo;{graphic.reviewText}&rdquo;</p>
          )}

          {/* Captions */}
          {editing ? (
            <div className="space-y-2">
              <EditField label="Pull quote" value={form.pullQuote} onChange={(v) => setForm({ ...form, pullQuote: v })} />
              <EditField label="Instagram caption" value={form.instagramCaption} onChange={(v) => setForm({ ...form, instagramCaption: v })} multiline />
              <EditField label="Story caption" value={form.storiesCaption} onChange={(v) => setForm({ ...form, storiesCaption: v })} multiline />
              <EditField label="Facebook caption" value={form.facebookCaption} onChange={(v) => setForm({ ...form, facebookCaption: v })} multiline />
              <EditField label="CTA" value={form.cta} onChange={(v) => setForm({ ...form, cta: v })} />
              <EditField label="Hashtags (comma separated)" value={form.hashtags} onChange={(v) => setForm({ ...form, hashtags: v })} />
            </div>
          ) : (
            <div className="space-y-1.5 text-[12px]">
              {graphic.pullQuote && <p className="font-medium text-foreground">&ldquo;{graphic.pullQuote}&rdquo;</p>}
              {graphic.instagramCaption && <CaptionRow label="IG" text={graphic.instagramCaption} />}
              {graphic.storiesCaption && <CaptionRow label="Story" text={graphic.storiesCaption} />}
              {graphic.facebookCaption && <CaptionRow label="FB" text={graphic.facebookCaption} />}
              {graphic.cta && <p className="text-[11px] text-primary font-medium">CTA: {graphic.cta}</p>}
              {graphic.hashtags && graphic.hashtags.length > 0 && (
                <p className="text-[11px] text-muted-foreground/60">
                  {graphic.hashtags.map((h) => `#${h}`).join(" ")}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {editing ? (
              <>
                <ActionBtn onClick={saveCaptions} disabled={busy} icon={Save} label="Save" primary />
                <ActionBtn onClick={() => setEditing(false)} disabled={busy} icon={X} label="Cancel" />
              </>
            ) : (
              <>
                {graphic.status !== "approved" && (
                  <ActionBtn onClick={() => act({ action: "approve" })} disabled={busy} icon={Check} label="Approve" primary />
                )}
                {graphic.status !== "rejected" && (
                  <ActionBtn onClick={() => act({ action: "reject" })} disabled={busy} icon={X} label="Reject" />
                )}
                <ActionBtn onClick={() => setEditing(true)} disabled={busy} icon={Pencil} label="Edit copy" />
              </>
            )}
          </div>
        </div>
      </div>
      {lightbox && <Lightbox images={lightbox.images} start={lightbox.start} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
    generating: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    error: "bg-red-500/15 text-red-600 dark:text-red-400",
  };
  return (
    <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", map[status] || "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

function CaptionRow({ label, text }: { label: string; text: string }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      <span className="font-semibold text-muted-foreground/80">{label}:</span> {text}
    </p>
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

function ActionBtn({
  onClick, disabled, icon: Icon, label, primary,
}: { onClick: () => void; disabled?: boolean; icon: React.ComponentType<{ className?: string }>; label: string; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "border border-border bg-background text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
