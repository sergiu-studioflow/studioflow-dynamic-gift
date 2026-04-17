"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  ExternalLink,
  RefreshCw,
  Trash2,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { useClient } from "@/lib/client-context";
import { META_AD_COUNTRIES } from "./countries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Competitor {
  id: string;
  clientId: string;
  competitorName: string;
  metaPageId: string | null;
  metaSearchTerms: string | null;
  tiktokHandle: string | null;
  instagramHandle: string | null;
  websiteUrl: string | null;
  category: string | null;
  competitorType: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function CompetitorManagementTab({
  onRefresh,
}: {
  onRefresh: () => void;
}) {
  const { clientSlug, clientId } = useClient();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMetaPageId, setNewMetaPageId] = useState("");
  const [newCountry, setNewCountry] = useState("GB");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<{ id: string; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadCompetitors = useCallback(async () => {
    if (!clientSlug) return;
    try {
      const res = await fetch(`/api/clients/${clientSlug}/competitors`);
      if (res.ok) {
        const data = await res.json();
        setCompetitors(data);
      }
    } catch (err) {
      console.error("Failed to load competitors:", err);
    } finally {
      setLoading(false);
    }
  }, [clientSlug]);

  useEffect(() => {
    loadCompetitors();
  }, [loadCompetitors]);

  // Filter to only those with a metaPageId (Meta competitors)
  const metaCompetitors = competitors.filter((c) => c.metaPageId);

  function extractPageId(input: string): string {
    // Try to extract view_all_page_id from a Meta Ad Library URL
    try {
      const url = new URL(input);
      const pageId = url.searchParams.get("view_all_page_id");
      if (pageId) return pageId;
    } catch {
      // Not a URL — treat as raw page ID
    }
    return input.trim();
  }

  async function handleAdd() {
    if (!newName.trim() || !newMetaPageId.trim() || !clientSlug) return;
    setAdding(true);
    setAddError(null);

    const pageId = extractPageId(newMetaPageId);
    if (!pageId) {
      setAddError("Could not extract a valid page ID");
      setAdding(false);
      return;
    }

    try {
      const res = await fetch(`/api/clients/${clientSlug}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorName: newName,
          metaPageId: pageId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Failed to add competitor");
        return;
      }
      setNewName("");
      setNewMetaPageId("");
      setNewCountry("GB");
      setShowAddForm(false);
      loadCompetitors();
      onRefresh();
    } catch {
      setAddError("Network error");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this competitor? Existing ad data will be preserved.")) return;
    if (!clientSlug) return;
    setDeletingId(id);
    try {
      await fetch(`/api/clients/${clientSlug}/competitors/${id}`, {
        method: "DELETE",
      });
      loadCompetitors();
      onRefresh();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefreshScrape(competitor: Competitor) {
    if (!competitor.metaPageId) return;
    setRefreshingId(competitor.id);
    setRefreshResult(null);
    try {
      const res = await fetch("/api/competitor-ads/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: competitor.id,
          competitorPageId: competitor.metaPageId,
          clientId,
        }),
      });
      const data = await res.json();
      if (data.empty) {
        setRefreshResult({ id: competitor.id, message: "No active ads found" });
      } else if (data.error) {
        setRefreshResult({ id: competitor.id, message: data.error });
      } else {
        setRefreshResult({ id: competitor.id, message: "Scrape triggered! Results will appear shortly." });
      }
      onRefresh();
    } catch {
      setRefreshResult({ id: competitor.id, message: "Failed to reach scraper" });
    } finally {
      setRefreshingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Competitors</h2>
          <p className="text-sm text-muted-foreground">
            Add Meta Ad Library page IDs to track competitor ads.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Competitor
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">New Competitor</h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Competitor Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Hismile"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Meta Ad Library Link or Page ID
              </label>
              <input
                type="text"
                value={newMetaPageId}
                onChange={(e) => setNewMetaPageId(e.target.value)}
                placeholder="https://www.facebook.com/ads/library/?...view_all_page_id=... or raw page ID"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/30"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Paste a Meta Ad Library URL or a raw page ID
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Country
              </label>
              <Select value={newCountry} onValueChange={setNewCountry}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {META_AD_COUNTRIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label} ({c.value})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {addError && (
            <p className="text-sm text-red-500">{addError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim() || !newMetaPageId.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </button>
            <button
              onClick={() => { setShowAddForm(false); setAddError(null); }}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && metaCompetitors.length === 0 && !showAddForm && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">No Meta competitors added</p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Add a Meta Ad Library page ID to start tracking competitor ads.
          </p>
        </div>
      )}

      {/* Competitor list */}
      <div className="space-y-3">
        {metaCompetitors.map((competitor) => (
          <div
            key={competitor.id}
            className={`rounded-xl border bg-card p-4 transition-all ${
              competitor.isActive ? "border-border" : "border-border/50 opacity-60"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground truncate">
                    {competitor.competitorName}
                  </h3>
                  <Badge variant={competitor.isActive ? "success" : "secondary"} className="text-[10px]">
                    {competitor.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <a
                    href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${competitor.metaPageId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-primary truncate max-w-[300px]"
                  >
                    Meta Ad Library <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  <span className="text-muted-foreground/60">ID: {competitor.metaPageId}</span>
                </div>
                {refreshResult?.id === competitor.id && (
                  <p className="text-xs text-muted-foreground mt-1">{refreshResult.message}</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleRefreshScrape(competitor)}
                  disabled={refreshingId === competitor.id || !competitor.isActive}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  title="Scrape now"
                >
                  {refreshingId === competitor.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {refreshingId === competitor.id ? "Scraping..." : "Refresh"}
                </button>

                <button
                  onClick={() => handleDelete(competitor.id)}
                  disabled={deletingId === competitor.id}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
