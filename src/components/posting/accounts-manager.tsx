"use client";

import { useCallback, useEffect, useState } from "react";
import { Instagram, Facebook, CheckCircle2, XCircle, HelpCircle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/client-context";
import type { SocialAccount, PostingPrefs } from "./types";

const PLATFORMS: ("facebook" | "instagram")[] = ["facebook", "instagram"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HEALTH: Record<string, { icon: typeof CheckCircle2; label: string; cls: string }> = {
  ok: { icon: CheckCircle2, label: "Connected", cls: "text-emerald-500" },
  unverified: { icon: HelpCircle, label: "Unverified", cls: "text-muted-foreground" },
  token_invalid: { icon: XCircle, label: "Token invalid", cls: "text-destructive" },
  error: { icon: XCircle, label: "Error", cls: "text-destructive" },
};

export function AccountsManager() {
  const { clientId, clientName, isAllClients } = useClient();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PostingPrefs | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) return;
    const [aRes, pRes] = await Promise.all([
      fetch(`/api/posting/accounts?clientId=${clientId}`),
      fetch(`/api/posting/prefs?clientId=${clientId}`),
    ]);
    if (aRes.ok) setAccounts(await aRes.json());
    if (pRes.ok) setPrefs(await pRes.json());
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const accountFor = (platform: string) => accounts.find((a) => a.platform === platform);

  async function saveAccount(platform: "facebook" | "instagram") {
    if (!clientId) return;
    const externalId = (drafts[platform] ?? accountFor(platform)?.externalId ?? "").trim();
    if (!externalId) return;
    setBusy(platform);
    try {
      await fetch("/api/posting/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, platform, externalId }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string, platform: string) {
    setBusy(platform);
    try {
      await fetch("/api/posting/accounts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggle(id: string, enabled: boolean, platform: string) {
    setBusy(platform);
    try {
      await fetch("/api/posting/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function savePrefs() {
    if (!clientId || !prefs) return;
    setSavingPrefs(true);
    try {
      await fetch("/api/posting/prefs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, prefs }),
      });
      await load();
    } finally {
      setSavingPrefs(false);
    }
  }

  if (isAllClients) {
    return <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">Select a brand to manage its connected accounts.</p>;
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h3 className="mb-1 text-sm font-semibold">Connected accounts — {clientName}</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Enter the Facebook Page ID and Instagram Business account ID for this brand. One agency Meta System User token (Settings → API Keys → Meta System User Token) authorises all brands. Hit Test to verify.
        </p>
        <div className="space-y-3">
          {PLATFORMS.map((platform) => {
            const acct = accountFor(platform);
            const health = HEALTH[acct?.health || "unverified"];
            const HIcon = health.icon;
            const Icon = platform === "instagram" ? Instagram : Facebook;
            const value = drafts[platform] ?? acct?.externalId ?? "";
            return (
              <div key={platform} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium capitalize">{platform}</span>
                  {acct && (
                    <span className={`ml-2 flex items-center gap-1 text-xs ${health.cls}`}>
                      <HIcon className="h-3.5 w-3.5" /> {health.label}
                      {acct.externalName ? ` · ${acct.externalName}` : ""}
                    </span>
                  )}
                  {acct && (
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={acct.enabled} onChange={(e) => toggle(acct.id, e.target.checked, platform)} className="h-3.5 w-3.5" />
                      enabled
                    </label>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={value}
                    onChange={(e) => setDrafts((d) => ({ ...d, [platform]: e.target.value }))}
                    placeholder={platform === "instagram" ? "ig_user_id (e.g. 17841400000000000)" : "page_id (e.g. 1000000000000)"}
                    className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <Button size="sm" variant="outline" onClick={() => saveAccount(platform)} disabled={busy === platform || !value.trim()}>
                    Save
                  </Button>
                  {acct && (
                    <Button size="sm" onClick={() => test(acct.id, platform)} disabled={busy === platform}>
                      {busy === platform ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                    </Button>
                  )}
                </div>
                {acct?.healthError && <p className="mt-1.5 text-[11px] text-destructive">{acct.healthError}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {prefs && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Posting schedule</h3>
          <p className="mb-4 text-xs text-muted-foreground">Auto-slot fills these times, in this timezone, on the selected days.</p>
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <label className="block text-xs font-medium">
              Timezone (IANA)
              <input
                value={prefs.timezone}
                onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium">
              Slot times (comma-separated, HH:MM)
              <input
                value={prefs.slotTimes.join(", ")}
                onChange={(e) => setPrefs({ ...prefs, slotTimes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
            <div className="text-xs font-medium">
              Days
              <div className="mt-1 flex gap-1.5">
                {DAYS.map((d, i) => {
                  const on = prefs.daysOfWeek.includes(i);
                  return (
                    <button
                      key={d}
                      onClick={() =>
                        setPrefs({
                          ...prefs,
                          daysOfWeek: on ? prefs.daysOfWeek.filter((x) => x !== i) : [...prefs.daysOfWeek, i].sort(),
                        })
                      }
                      className={`rounded-md px-2 py-1 text-[11px] ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block text-xs font-medium">
              Max posts per day
              <input
                type="number"
                min={1}
                value={prefs.maxPerDay}
                onChange={(e) => setPrefs({ ...prefs, maxPerDay: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                className="mt-1 w-24 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
            <Button size="sm" onClick={savePrefs} disabled={savingPrefs}>
              {savingPrefs ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              Save schedule
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
