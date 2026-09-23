"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClient } from "@/lib/client-context";
import { CATEGORIES, MARKETS, CURRENCIES, HEX_COLOR, type EditableClientField } from "@/lib/client-fields";
import type { Client } from "@/lib/types";

type Form = Record<EditableClientField, string>;

const INPUT =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors";

function toForm(client: Client): Form {
  return {
    website: client.website ?? "",
    category: client.category ?? "",
    primaryMarket: client.primaryMarket ?? "",
    currency: client.currency ?? "",
    cluster: client.cluster ?? "",
    brandColor: client.brandColor ?? "",
    notes: client.notes ?? "",
  };
}

/** A select that keeps a stored value visible even when it predates the current options. */
function OptionSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      <option value="">{placeholder}</option>
      {all.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

export function ClientDetailsEditor({
  client,
  onSaved,
  onCancel,
}: {
  client: Client;
  onSaved: (client: Client) => void;
  onCancel: () => void;
}) {
  const { refetchClients } = useClient();
  const [form, setForm] = useState<Form>(() => toForm(client));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (patch: Partial<Form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError("");
  };

  async function save() {
    if (form.brandColor.trim() && !HEX_COLOR.test(form.brandColor.trim())) {
      setError("Brand colour must be a hex value like #1a2b3c, or left empty.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/clients/${client.clientSlug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not save (${res.status})`);
        return;
      }
      // The Clients grid and the sidebar switcher show these fields too.
      await refetchClients();
      onSaved(data as Client);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium">Website</label>
          <input
            type="url"
            value={form.website}
            onChange={(e) => update({ website: e.target.value })}
            placeholder="https://example.com"
            className={INPUT}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Category</label>
          <OptionSelect
            value={form.category}
            options={CATEGORIES}
            placeholder="Select category..."
            onChange={(category) => update({ category })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Primary Market</label>
          <OptionSelect
            value={form.primaryMarket}
            options={MARKETS}
            placeholder="Select market..."
            onChange={(primaryMarket) => update({ primaryMarket })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Currency</label>
          <OptionSelect
            value={form.currency}
            options={CURRENCIES}
            placeholder="Select currency..."
            onChange={(currency) => update({ currency })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Label / Group</label>
          <input
            type="text"
            value={form.cluster}
            onChange={(e) => update({ cluster: e.target.value })}
            placeholder="e.g. Custom Headwear"
            className={INPUT}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Brand Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Pick brand colour"
              value={HEX_COLOR.test(form.brandColor) ? form.brandColor : "#ffffff"}
              onChange={(e) => update({ brandColor: e.target.value })}
              className={cn("h-9 w-12 cursor-pointer rounded border border-border", !form.brandColor && "opacity-40")}
            />
            <input
              type="text"
              value={form.brandColor}
              onChange={(e) => update({ brandColor: e.target.value })}
              placeholder="Not set"
              className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 transition-colors"
            />
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
            rows={3}
            className={cn(INPUT, "resize-none")}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Category and market also tell Quality Control and the Ad Prompt Builder what kind of brand this is.
        The label groups brands in the client switcher.
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  );
}
