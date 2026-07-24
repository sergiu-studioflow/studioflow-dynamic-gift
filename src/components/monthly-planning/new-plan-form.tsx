"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Brand = { id: string; clientName: string };

export function NewPlanForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 2).padStart(2, "0")}`.replace(/-13$/, () => `${now.getUTCFullYear() + 1}-01`);
  const [month, setMonth] = useState(defaultMonth);
  const [postsPerBrand, setPostsPerBrand] = useState(8);
  const [staticPct, setStaticPct] = useState(60);
  const [themes, setThemes] = useState("");
  const [campaigns, setCampaigns] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown[]) =>
        setBrands(
          (Array.isArray(data) ? data : [])
            .map((c) => c as Record<string, string>)
            .map((c) => ({ id: c.id, clientName: c.clientName || c.brandName || c.name || "" }))
            .filter((b) => b.id)
        )
      )
      .catch(() => {});
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function submit() {
    if (selected.size === 0) {
      setError("Pick at least one brand.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/monthly-planning/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${month} — ${selected.size} brand${selected.size > 1 ? "s" : ""}`,
          inputConfig: {
            brands: [...selected],
            month,
            postsPerBrand,
            platforms: ["facebook", "instagram"],
            staticRatio: staticPct / 100,
            themes,
            campaigns,
            notes,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create plan");
        return;
      }
      onCreated(data.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> New monthly plan
        </h2>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium">Brands</label>
        <div className="flex flex-wrap gap-1.5">
          {brands.map((b) => (
            <button
              key={b.id}
              onClick={() => toggle(b.id)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${selected.has(b.id) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
            >
              {b.clientName}
            </button>
          ))}
          {brands.length === 0 && <span className="text-xs text-muted-foreground">Loading brands…</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block text-xs font-medium">
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block text-xs font-medium">
          Posts per brand
          <input type="number" min={1} max={60} value={postsPerBrand} onChange={(e) => setPostsPerBrand(Math.max(1, Math.min(60, parseInt(e.target.value || "1", 10))))} className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
        </label>
      </div>

      <label className="block text-xs font-medium">
        Static vs video mix — {staticPct}% static / {100 - staticPct}% video
        <input type="range" min={0} max={100} step={10} value={staticPct} onChange={(e) => setStaticPct(parseInt(e.target.value, 10))} className="mt-2 w-full accent-[var(--primary)]" />
      </label>

      <label className="block text-xs font-medium">
        Monthly themes
        <textarea value={themes} onChange={(e) => setThemes(e.target.value)} rows={2} placeholder="e.g. EOFY promotions, new lanyard range, sustainability" className="mt-1 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" />
      </label>
      <label className="block text-xs font-medium">
        Campaigns / brand priorities
        <textarea value={campaigns} onChange={(e) => setCampaigns(e.target.value)} rows={2} placeholder="e.g. push the concierge service; highlight fast turnaround for events" className="mt-1 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" />
      </label>
      <label className="block text-xs font-medium">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full resize-none rounded-md border border-input bg-background p-2 text-sm" />
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={submitting || selected.size === 0}>
          {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
          {submitting ? "Planning the month…" : "Generate plan"}
        </Button>
      </div>
    </div>
  );
}
