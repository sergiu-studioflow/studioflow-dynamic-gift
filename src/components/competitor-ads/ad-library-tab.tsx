"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Search, Loader2, AlertTriangle } from "lucide-react";
import { useClient } from "@/lib/client-context";
import type { CompetitorAd, Snapshot } from "./types";

type CompetitorSource = {
  id: string;
  name: string;
  competitorPageId: string;
  metaLibraryUrl: string;
  country: string;
  isActive: boolean;
  lastScrapedAt: string | null;
  createdAt: Date;
  updatedAt: Date;
};
import { computeBadge } from "./utils";
import { GalleryCard } from "./gallery-card";
import { FullViewModal } from "./full-view-modal";

const MEDIA_TYPES = ["Video", "Image", "Carousel", "Text"] as const;

const SORT_OPTIONS = [
  { value: "meta_default", label: "Meta Default" },
  { value: "newest", label: "Newest First" },
  { value: "longest", label: "Longest Running" },
];

export function AdLibraryTab({
  sources,
  onSourcesRefresh,
}: {
  sources: CompetitorSource[];
  onSourcesRefresh: () => void;
}) {
  const { clientId } = useClient();
  const [ads, setAds] = useState<CompetitorAd[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>("");
  const [currentSnapshotId, setCurrentSnapshotId] = useState<string>("");
  const [selectedAd, setSelectedAd] = useState<CompetitorAd | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<{ type: "success" | "error" | "empty"; text: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMediaTypes, setActiveMediaTypes] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState("meta_default");

  // Auto-select first active source
  useEffect(() => {
    if (!selectedSourceId && sources.length > 0) {
      const firstActive = sources.find((s) => s.isActive) || sources[0];
      setSelectedSourceId(firstActive.id);
    }
  }, [sources, selectedSourceId]);

  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  // Load ads when source or snapshot changes
  const loadAds = useCallback(async () => {
    if (!selectedSource) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        competitor_page_id: selectedSource.competitorPageId,
      });
      if (selectedSnapshot) {
        params.set("snapshot_id", selectedSnapshot);
      }
      if (clientId) {
        params.set("clientId", clientId);
      }
      const res = await fetch(`/api/competitor-ads?${params}`);
      const data = await res.json();
      setAds(data.ads || []);
      setSnapshots(data.snapshots || []);
      setCurrentSnapshotId(data.currentSnapshotId || "");
    } catch (err) {
      console.error("Failed to load ads:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedSource, selectedSnapshot, clientId]);

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  // Polling ref to track interval
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Refresh (trigger scrape, then poll for results)
  async function handleRefresh() {
    if (!selectedSourceId) return;
    setRefreshing(true);
    setRefreshMessage(null);

    try {
      // 1. Trigger the scrape (fire-and-forget — n8n returns immediately)
      const res = await fetch("/api/competitor-ads/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: selectedSourceId,
          clientId,
          country: sources.find(s => s.id === selectedSourceId)?.country || "ALL",
        }),
      });
      const data = await res.json();

      if (data.error) {
        setRefreshMessage({ type: "error", text: data.error });
        setRefreshing(false);
        return;
      }

      const previousSnapshotId = data.previousSnapshotId;
      const competitorPageId = data.competitorPageId;

      setRefreshMessage({ type: "success", text: "Scraping in progress... this usually takes 1–3 minutes." });

      // 2. Poll the database every 10s for up to 5 minutes
      pollCountRef.current = 0;
      if (pollRef.current) clearInterval(pollRef.current);

      pollRef.current = setInterval(async () => {
        pollCountRef.current++;

        try {
          const params = new URLSearchParams({ competitor_page_id: competitorPageId });
          if (clientId) params.set("clientId", clientId);
          const pollRes = await fetch(`/api/competitor-ads?${params}`);
          const pollData = await pollRes.json();
          const latestSnap = pollData.snapshots?.[0]?.snapshotId;

          // New snapshot appeared — scraping is done
          if (latestSnap && latestSnap !== previousSnapshotId) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;

            setRefreshMessage({ type: "success", text: "Scrape complete! Loading new ads..." });
            setSelectedSnapshot("");
            setAds(pollData.ads || []);
            setSnapshots(pollData.snapshots || []);
            setCurrentSnapshotId(pollData.currentSnapshotId || "");
            setRefreshing(false);
            onSourcesRefresh();
          }
        } catch {
          // Polling error — keep trying
        }

        // Timeout after 30 polls (5 minutes at 10s intervals)
        if (pollCountRef.current >= 30) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRefreshMessage({ type: "empty", text: "Scrape is still running. Refresh the page in a minute to check for results." });
          setRefreshing(false);
        }
      }, 10_000);

    } catch {
      setRefreshMessage({ type: "error", text: "Failed to trigger the scrape." });
      setRefreshing(false);
    }
  }

  // Client-side filtering + sorting
  const filteredAds = useMemo(() => {
    let result = [...ads];

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (ad) =>
          ad.creativeAngle?.toLowerCase().includes(q) ||
          ad.headlineTitle?.toLowerCase().includes(q) ||
          ad.displayPrimaryText?.toLowerCase().includes(q) ||
          ad.adDescription?.toLowerCase().includes(q)
      );
    }

    // Media type filter
    if (activeMediaTypes.size > 0) {
      result = result.filter((ad) => activeMediaTypes.has(ad.mediaType));
    }

    // Sort
    if (sortBy === "newest") {
      result.sort((a, b) => b.adStartDate.localeCompare(a.adStartDate));
    } else if (sortBy === "longest") {
      result.sort((a, b) => {
        const daysA = computeBadge(a.snapshotDate, a.adStartDate).days;
        const daysB = computeBadge(b.snapshotDate, b.adStartDate).days;
        return daysB - daysA;
      });
    }
    // "meta_default" keeps original order (metaSortRank ASC from API)

    return result;
  }, [ads, searchQuery, activeMediaTypes, sortBy]);

  // Media type counts
  const mediaTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ad of ads) {
      counts[ad.mediaType] = (counts[ad.mediaType] || 0) + 1;
    }
    return counts;
  }, [ads]);

  function toggleMediaType(type: string) {
    setActiveMediaTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  // Keyboard: Escape to close modal
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedAd) setSelectedAd(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedAd]);

  const activeSources = sources.filter((s) => s.isActive);

  return (
    <div className="space-y-5">
      {/* Top bar: Competitor + Snapshot + Refresh */}
      <div className="flex flex-wrap items-center gap-3">
        {activeSources.length > 0 && (
          <Select
            value={selectedSourceId}
            onValueChange={(v) => {
              setSelectedSourceId(v);
              setSelectedSnapshot("");
              setRefreshMessage(null);
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select competitor" />
            </SelectTrigger>
            <SelectContent>
              {activeSources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {snapshots.length > 0 && (
          <Select
            value={selectedSnapshot || currentSnapshotId}
            onValueChange={setSelectedSnapshot}
          >
            <SelectTrigger className="w-[360px]">
              <SelectValue placeholder="Latest snapshot" />
            </SelectTrigger>
            <SelectContent>
              {snapshots.map((s, i) => (
                <SelectItem key={s.snapshotId} value={s.snapshotId}>
                  {s.snapshotLabel}
                  {i === 0 ? " (latest)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <button
          onClick={handleRefresh}
          disabled={refreshing || !selectedSourceId}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {refreshing ? "Scraping..." : "Refresh"}
        </button>

        {!loading && (
          <span className="text-sm text-muted-foreground">
            {filteredAds.length} of {ads.length} ad{ads.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Refresh message banner */}
      {refreshMessage && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            refreshMessage.type === "error"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
              : refreshMessage.type === "empty"
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {refreshMessage.text}
          <button
            onClick={() => setRefreshMessage(null)}
            className="ml-auto text-current/60 hover:text-current"
          >
            ×
          </button>
        </div>
      )}

      {/* Filters: Search + Media type chips + Sort */}
      {ads.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search angles, headlines, copy..."
              className="w-[260px] rounded-lg border border-input bg-background pl-9 pr-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/30"
            />
          </div>

          {/* Media type chips */}
          <div className="flex items-center gap-1.5">
            {MEDIA_TYPES.map((type) => {
              const count = mediaTypeCounts[type] || 0;
              if (count === 0) return null;
              const isActive = activeMediaTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleMediaType(type)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {type} ({count})
                </button>
              );
            })}
            {activeMediaTypes.size > 0 && (
              <button
                onClick={() => setActiveMediaTypes(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* Sort */}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && ads.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
          <p className="text-lg font-medium text-muted-foreground">No ads found</p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            {sources.length === 0
              ? "Add a competitor in the Competitors tab to get started."
              : "Click Refresh to scrape this competitor's ads."}
          </p>
        </div>
      )}

      {/* No filter results */}
      {!loading && ads.length > 0 && filteredAds.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No ads match your filters</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setActiveMediaTypes(new Set());
            }}
            className="mt-2 text-sm text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Gallery Grid */}
      {!loading && filteredAds.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filteredAds.map((ad) => (
            <GalleryCard key={ad.id} ad={ad} onClick={() => setSelectedAd(ad)} />
          ))}
        </div>
      )}

      {/* Full View Modal */}
      {selectedAd && (
        <FullViewModal ad={selectedAd} onClose={() => setSelectedAd(null)} />
      )}
    </div>
  );
}
