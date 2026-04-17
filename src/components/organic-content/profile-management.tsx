"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  ExternalLink,
  Loader2,
  Check,
  Trash2,
  Play,
  Eye,
  User,
  AlertTriangle,
} from "lucide-react";
import { useClient } from "@/lib/client-context";
import type { OrganicProfile } from "./types";
import { timeAgo, formatNumber, parseUsernameFromUrl } from "./utils";

const POST_COUNT_OPTIONS = [50, 100, 200] as const;

type StatusBadgeVariant = "secondary" | "outline" | "success" | "destructive";
const STATUS_CONFIG: Record<string, { variant: StatusBadgeVariant; label: string }> = {
  "Not Initialized": { variant: "secondary", label: "Not Initialized" },
  Processing: { variant: "outline", label: "Processing" },
  Active: { variant: "success", label: "Active" },
  Error: { variant: "destructive", label: "Error" },
  Paused: { variant: "secondary", label: "Paused" },
};

export function ProfileManagement({
  platform,
  onViewPosts,
}: {
  platform: "tiktok" | "instagram";
  onViewPosts?: (profileId: number) => void;
}) {
  const { clientId } = useClient();
  const [profiles, setProfiles] = useState<OrganicProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [initializingId, setInitializingId] = useState<number | null>(null);
  const [initPostCount, setInitPostCount] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // Polling refs for processing profiles
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const loadProfiles = useCallback(async () => {
    try {
      const params = new URLSearchParams({ platform });
      if (clientId) params.set("clientId", clientId);
      const res = await fetch(`/api/organic-profiles?${params}`);
      const data = await res.json();
      setProfiles(data);
    } catch (err) {
      console.error("Failed to load profiles:", err);
    } finally {
      setLoading(false);
    }
  }, [platform, clientId]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Start polling when a profile is Processing
  function startPolling(profileId: number) {
    pollCountRef.current = 0;
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      pollCountRef.current++;
      try {
        const statusParams = new URLSearchParams();
        if (clientId) statusParams.set("clientId", clientId);
        const res = await fetch(`/api/organic-profiles/${profileId}/status?${statusParams}`);
        const data = await res.json();

        if (data.trackingStatus === "Active" || data.trackingStatus === "Error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setInitializingId(null);
          loadProfiles();
        }
      } catch { /* keep polling */ }

      // Timeout after 60 polls (10 minutes at 10s)
      if (pollCountRef.current >= 60) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setInitializingId(null);
        loadProfiles();
      }
    }, 10_000);
  }

  async function handleAdd() {
    if (!newLabel.trim() || !newUrl.trim()) return;
    setAdding(true);
    setAddError(null);

    try {
      const res = await fetch("/api/organic-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customLabel: newLabel,
          profileUrl: newUrl,
          platform,
          clientId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Failed to add profile");
        return;
      }
      setNewLabel("");
      setNewUrl("");
      setShowAddForm(false);
      loadProfiles();
    } catch {
      setAddError("Network error");
    } finally {
      setAdding(false);
    }
  }

  async function handleInitialize(profileId: number, postsNumber: number) {
    setInitializingId(profileId);
    setInitPostCount(null);
    setInitError(null);

    try {
      const res = await fetch("/api/organic-profiles/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, postsNumber, clientId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInitError(data.error || "Failed to initialize");
        setInitializingId(null);
        loadProfiles();
        return;
      }

      // Update local state optimistically
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profileId ? { ...p, trackingStatus: "Processing" as const } : p
        )
      );

      // Start polling for status change
      startPolling(profileId);
    } catch {
      setInitError("Network error");
      setInitializingId(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this profile? All tracked posts will also be removed.")) return;
    setDeletingId(id);
    try {
      await fetch("/api/organic-profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, clientId }),
      });
      loadProfiles();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggle(profile: OrganicProfile) {
    setTogglingId(profile.id);
    try {
      await fetch("/api/organic-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: profile.id,
          trackingStatus: profile.trackingStatus === "Active" ? "Paused" : "Active",
          clientId,
        }),
      });
      loadProfiles();
    } finally {
      setTogglingId(null);
    }
  }

  const platformLabel = platform === "tiktok" ? "TikTok" : "Instagram";
  const urlPlaceholder =
    platform === "tiktok"
      ? "https://www.tiktok.com/@username"
      : "https://www.instagram.com/username";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {platformLabel} Competitors
          </h2>
          <p className="text-sm text-muted-foreground">
            Add {platformLabel} profiles to track organic content.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Profile
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">
            New {platformLabel} Profile
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Label
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g., Main Competitor"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Profile URL
              </label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder={urlPlaceholder}
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/30"
              />
            </div>
          </div>
          {addError && <p className="text-sm text-red-500">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={adding || !newLabel.trim() || !newUrl.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setAddError(null);
              }}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Init error */}
      {initError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {initError}
          <button onClick={() => setInitError(null)} className="ml-auto text-current/60 hover:text-current">
            ×
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && profiles.length === 0 && !showAddForm && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            No {platformLabel} profiles added
          </p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Add a {platformLabel} profile URL to start tracking organic content.
          </p>
        </div>
      )}

      {/* Profiles list */}
      <div className="space-y-3">
        {profiles.map((profile) => {
          const statusConf = STATUS_CONFIG[profile.trackingStatus] || STATUS_CONFIG["Not Initialized"];
          const isProcessing = profile.trackingStatus === "Processing" || initializingId === profile.id;
          const usernameDisplay = profile.username
            ? `@${profile.username}`
            : parseUsernameFromUrl(profile.profileUrl)
            ? `@${parseUsernameFromUrl(profile.profileUrl)}`
            : "—";

          return (
            <div
              key={profile.id}
              className={`rounded-xl border bg-card p-4 transition-all ${
                profile.trackingStatus === "Active"
                  ? "border-border"
                  : "border-border/50 opacity-80"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Avatar */}
                  <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                    {profile.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt={profile.customLabel}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground truncate">
                        {profile.customLabel}
                      </h3>
                      <Badge
                        variant={statusConf.variant}
                        className="text-[10px]"
                      >
                        {isProcessing ? "Processing..." : statusConf.label}
                      </Badge>
                      {profile.isVerified && (
                        <Badge variant="outline" className="text-[10px]">
                          Verified
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <a
                        href={profile.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-primary truncate"
                      >
                        {usernameDisplay}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      {profile.displayName && (
                        <span className="truncate">{profile.displayName}</span>
                      )}
                      <span>
                        {formatNumber(profile.followerCount)} followers
                      </span>
                      <span>{profile.postCount || 0} posts tracked</span>
                      <span>
                        Last scraped: {timeAgo(profile.lastScrapedAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Action button based on status */}
                  {profile.trackingStatus === "Not Initialized" && (
                    <div className="relative">
                      {initPostCount === profile.id ? (
                        <div className="flex items-center gap-1.5">
                          {POST_COUNT_OPTIONS.map((count) => (
                            <button
                              key={count}
                              onClick={() => handleInitialize(profile.id, count)}
                              className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                            >
                              {count}
                            </button>
                          ))}
                          <button
                            onClick={() => setInitPostCount(null)}
                            className="text-xs text-muted-foreground hover:text-foreground ml-1"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setInitPostCount(profile.id)}
                          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Initialize
                        </button>
                      )}
                    </div>
                  )}

                  {isProcessing && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Initializing...
                    </span>
                  )}

                  {profile.trackingStatus === "Active" && onViewPosts && (
                    <button
                      onClick={() => onViewPosts(profile.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View Posts
                    </button>
                  )}

                  {(profile.trackingStatus === "Active" || profile.trackingStatus === "Paused") && (
                    <button
                      onClick={() => handleToggle(profile)}
                      disabled={togglingId === profile.id}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        profile.trackingStatus === "Active"
                          ? "bg-primary"
                          : "bg-muted-foreground/30"
                      }`}
                      title={profile.trackingStatus === "Active" ? "Pause tracking" : "Resume tracking"}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          profile.trackingStatus === "Active" ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  )}

                  {profile.trackingStatus === "Error" && (
                    <button
                      onClick={() => setInitPostCount(profile.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      Retry
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(profile.id)}
                    disabled={deletingId === profile.id}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
