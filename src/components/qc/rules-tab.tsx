"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Config = {
  bannedPhrasings: string[];
  visualRules: string[];
  paletteHexes: string[];
  productFacts: string[];
  brandSafetyNotes: string | null;
  winnerProfile: string | null;
  winnerProfileSourceCount: number;
  winnerProfileUpdatedAt: string | null;
  version: number;
};

const linesToArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const arrToLines = (a: string[] | undefined) => (a ?? []).join("\n");

const FIELDS = [
  {
    key: "bannedPhrasings" as const,
    label: "Red-line phrases (hard-fail)",
    hint: "Unambiguous text errors only — wrong CTA domains, clear misspellings. Any substring match instantly fails brand fit. Do NOT put subjective rules here.",
    rows: 5,
  },
  {
    key: "visualRules" as const,
    label: "Brand rules",
    hint: "Fed verbatim to the judge. Keep each rule checkable by looking at the piece — vague rules produce false flags.",
    rows: 10,
  },
  {
    key: "paletteHexes" as const,
    label: "Ad-design palette (hex codes)",
    hint: "The only colours allowed on ad furniture (backgrounds, headlines, badges, CTA). Product colours are exempt — two-layer firewall.",
    rows: 4,
  },
  {
    key: "productFacts" as const,
    label: "Product facts",
    hint: "What the real products are like — materials, print construction, finish. Checked against the attached product photo.",
    rows: 5,
  },
];

export function RulesTab({
  clientId,
  clientName,
  canEdit,
}: {
  clientId: string | null;
  clientName: string;
  canEdit: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [winnerProfile, setWinnerProfile] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    const res = await fetch(`/api/qc/config?clientId=${clientId}`);
    if (res.ok) {
      const data = await res.json();
      const cfg: Config | null = data.config;
      setConfig(cfg);
      setForm({
        bannedPhrasings: arrToLines(cfg?.bannedPhrasings),
        visualRules: arrToLines(cfg?.visualRules),
        paletteHexes: arrToLines(cfg?.paletteHexes),
        productFacts: arrToLines(cfg?.productFacts),
      });
      setNotes(cfg?.brandSafetyNotes ?? "");
      setWinnerProfile(cfg?.winnerProfile ?? "");
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!clientId) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/qc/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        bannedPhrasings: linesToArr(form.bannedPhrasings ?? ""),
        visualRules: linesToArr(form.visualRules ?? ""),
        paletteHexes: linesToArr(form.paletteHexes ?? ""),
        productFacts: linesToArr(form.productFacts ?? ""),
        brandSafetyNotes: notes,
        winnerProfile,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage("Saved — future grades use the new rules.");
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setMessage(d.error || "Save failed");
    }
  }

  async function regenerateProfile() {
    if (!clientId) return;
    setRegenerating(true);
    setMessage(null);
    const res = await fetch("/api/qc/winner-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    const data = await res.json().catch(() => ({}));
    setRegenerating(false);
    if (res.ok) {
      setWinnerProfile(data.profile ?? "");
      setMessage(
        data.profile
          ? `Rebuilt from ${data.sourceCount} winner${data.sourceCount === 1 ? "" : "s"}.`
          : data.reason || "No profile could be built."
      );
      load();
    } else {
      setMessage(data.error || "Failed to rebuild the profile");
    }
  }

  if (!clientId) {
    return <p className="text-sm text-muted-foreground">Pick a client in the sidebar switcher to edit its QC rules.</p>;
  }
  if (loading) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Ruleset for {clientName}</h3>
        <p className="text-xs text-muted-foreground">
          What grounds every grade for this client. One item per line. Saving bumps the ruleset version (currently v
          {config?.version || 1}) — future grades use the new rules.
        </p>
      </div>

      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <label className="text-xs font-medium">{f.label}</label>
          <p className="text-[11px] text-muted-foreground">{f.hint}</p>
          <textarea
            className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            rows={f.rows}
            disabled={!canEdit}
            value={form[f.key] ?? ""}
            onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
        </div>
      ))}

      <div className="space-y-1.5">
        <label className="text-xs font-medium">House style &amp; advisory notes</label>
        <p className="text-[11px] text-muted-foreground">
          Free text. Tone, layout conventions, logo treatment — plus any portfolio-level rule the judge should treat as
          advisory only rather than fail a single piece on.
        </p>
        <textarea
          className="w-full rounded-md border border-border bg-background p-2 text-xs"
          rows={6}
          disabled={!canEdit}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Past-winners profile
          </label>
          {canEdit ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={regenerating} onClick={regenerateProfile}>
              {regenerating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Rebuild from Winners Library
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          What this client&apos;s best creatives have in common, read from the Winners Library. Used by the advisory
          &ldquo;matches past winners&rdquo; check — it is <strong>never</strong> a reason to block a piece, so a genuinely new
          idea is surfaced, not rejected. Edit it freely; your wording wins over the generated text.
          {config?.winnerProfileSourceCount
            ? ` Built from ${config.winnerProfileSourceCount} winner${config.winnerProfileSourceCount === 1 ? "" : "s"}.`
            : " No winners saved yet — the check stays n/a until at least 3 exist."}
        </p>
        <textarea
          className="w-full rounded-md border border-border bg-background p-2 text-xs"
          rows={8}
          disabled={!canEdit}
          value={winnerProfile}
          onChange={(e) => setWinnerProfile(e.target.value)}
          placeholder="No profile yet. Save winners to the Winners Library, then rebuild."
        />
      </div>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Save ruleset
          </Button>
          {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
