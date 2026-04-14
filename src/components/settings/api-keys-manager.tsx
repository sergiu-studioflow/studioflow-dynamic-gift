"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Key,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Save,
  Trash2,
  X,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ApiKeyInfo = {
  keyName: string;
  label: string;
  description: string;
  source: "custom" | "default" | "not_set";
  maskedValue: string;
  updatedAt: string | null;
};

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/settings/api-keys")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setKeys(data); })
      .catch(() => setMessage({ type: "error", text: "Failed to load API keys" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (keyName: string) => {
    if (!editValue.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyName, value: editValue.trim() }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: `${keys.find((k) => k.keyName === keyName)?.label} key updated` });
        setEditingKey(null);
        setEditValue("");
        load();
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (keyName: string) => {
    setDeleting(keyName);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyName }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Custom key removed — using default" });
        load();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to remove key" });
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Key className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">API Keys</h2>
          <p className="text-[11px] text-muted-foreground">
            Configure your own API keys for AI services. Keys are encrypted at rest.
          </p>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
          message.type === "success"
            ? "border-green-500/20 bg-green-500/5 text-green-500"
            : "border-red-500/20 bg-red-500/5 text-red-500"
        )}>
          {message.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto"><X className="h-3 w-3" /></button>
        </div>
      )}

      {/* Key cards */}
      <div className="space-y-3">
        {keys.map((key) => {
          const isEditing = editingKey === key.keyName;
          const isDeleting = deleting === key.keyName;

          return (
            <div
              key={key.keyName}
              className={cn(
                "rounded-xl border bg-card p-4 transition-all",
                key.source === "custom" ? "border-green-500/20" : key.source === "default" ? "border-border" : "border-amber-500/20"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground">{key.label}</h3>
                    {key.source === "custom" && (
                      <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[9px] font-medium text-green-500">
                        <Shield className="h-2.5 w-2.5" />
                        Custom
                      </span>
                    )}
                    {key.source === "default" && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                        Default
                      </span>
                    )}
                    {key.source === "not_set" && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-500">
                        Not set
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2">{key.description}</p>

                  {/* Current value */}
                  {key.maskedValue && !isEditing && (
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] font-mono text-muted-foreground/60 bg-muted/50 px-2 py-1 rounded">
                        {key.maskedValue}
                      </code>
                      {key.updatedAt && (
                        <span className="text-[9px] text-muted-foreground/40">
                          Updated {new Date(key.updatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Edit form */}
                  {isEditing && (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="password"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="Paste your API key..."
                        autoFocus
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <button
                        onClick={() => handleSave(key.keyName)}
                        disabled={!editValue.trim() || saving}
                        className={cn(
                          "flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
                          editValue.trim()
                            ? "bg-primary text-primary-foreground hover:brightness-110"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingKey(null); setEditValue(""); }}
                        className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!isEditing && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => { setEditingKey(key.keyName); setEditValue(""); }}
                      className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                    >
                      <Key className="h-3 w-3" />
                      {key.source === "not_set" ? "Add" : "Update"}
                    </button>
                    {key.source === "custom" && (
                      <button
                        onClick={() => handleDelete(key.keyName)}
                        disabled={isDeleting}
                        className="flex items-center gap-1 rounded-lg border border-red-500/20 px-2.5 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Info note */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3">
        <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-0.5">How it works</p>
          <p>Custom keys override the default keys for your portal. If you remove a custom key, the system falls back to the default. All keys are AES-256 encrypted at rest.</p>
        </div>
      </div>
    </div>
  );
}
