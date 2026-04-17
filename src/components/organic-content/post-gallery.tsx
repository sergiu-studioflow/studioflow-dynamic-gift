"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Loader2 } from "lucide-react";
import { useClient } from "@/lib/client-context";
import type { OrganicProfile, OrganicPost } from "./types";
import { PostGalleryCard } from "./post-gallery-card";
import { PostFullViewModal } from "./post-full-view-modal";

const CONTENT_TYPES = ["All", "Video", "Carousel"] as const;
const SORT_OPTIONS = [
  { value: "newest", label: "Newest First" },
  { value: "most_views", label: "Most Views" },
  { value: "most_likes", label: "Most Likes" },
];

export function PostGallery({
  platform,
  initialProfileId,
}: {
  platform: "tiktok" | "instagram";
  initialProfileId?: number | null;
}) {
  const { clientId } = useClient();
  const [profiles, setProfiles] = useState<OrganicProfile[]>([]);
  const [posts, setPosts] = useState<OrganicPost[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedPost, setSelectedPost] = useState<OrganicPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");

  // Load profiles
  useEffect(() => {
    async function load() {
      try {
        const params = new URLSearchParams({ platform });
        if (clientId) params.set("clientId", clientId);
        const res = await fetch(`/api/organic-profiles?${params}`);
        const data = await res.json();
        const activeProfiles = data.filter(
          (p: OrganicProfile) => p.trackingStatus === "Active"
        );
        setProfiles(activeProfiles);

        // Auto-select initial profile or first active
        if (initialProfileId) {
          setSelectedProfileId(String(initialProfileId));
        } else if (activeProfiles.length > 0) {
          setSelectedProfileId(String(activeProfiles[0].id));
        }
      } catch (err) {
        console.error("Failed to load profiles:", err);
      } finally {
        setLoadingProfiles(false);
      }
    }
    load();
  }, [platform, initialProfileId, clientId]);

  // Load posts when profile changes
  const loadPosts = useCallback(async () => {
    if (!selectedProfileId) return;
    setLoading(true);
    try {
      const postParams = new URLSearchParams({ profile_id: selectedProfileId });
      if (clientId) postParams.set("clientId", clientId);
      const res = await fetch(
        `/api/organic-posts?${postParams}`
      );
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (err) {
      console.error("Failed to load posts:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId, clientId]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  // Filter + sort
  const filteredPosts = useMemo(() => {
    let result = [...posts];

    // Content type filter (TikTok only)
    if (contentTypeFilter !== "All") {
      result = result.filter((p) => p.contentType === contentTypeFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.caption?.toLowerCase().includes(q) ||
          p.hashtags?.toLowerCase().includes(q) ||
          p.contentAngle?.toLowerCase().includes(q) ||
          p.contentMechanic?.toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortBy === "newest") {
      result.sort(
        (a, b) =>
          new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime()
      );
    } else if (sortBy === "most_views") {
      result.sort((a, b) => b.views - a.views);
    } else if (sortBy === "most_likes") {
      result.sort((a, b) => b.likes - a.likes);
    }

    return result;
  }, [posts, searchQuery, contentTypeFilter, sortBy]);

  // Content type counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { All: posts.length };
    for (const p of posts) {
      counts[p.contentType] = (counts[p.contentType] || 0) + 1;
    }
    return counts;
  }, [posts]);

  // Keyboard escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedPost) setSelectedPost(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedPost]);

  if (loadingProfiles) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          No active profiles
        </p>
        <p className="mt-1 text-sm text-muted-foreground/60">
          Add and initialize a profile in the Competitors tab to start viewing posts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top bar: Profile selector + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedProfileId}
          onValueChange={(v) => setSelectedProfileId(v)}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Select profile" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.customLabel}
                {p.username ? ` (@${p.username})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!loading && (
          <span className="text-sm text-muted-foreground">
            {filteredPosts.length} of {posts.length} post
            {posts.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Filters */}
      {posts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search captions, hashtags, angles..."
              className="w-[260px] rounded-lg border border-input bg-background pl-9 pr-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/30"
            />
          </div>

          {/* Content type chips — TikTok only */}
          {platform === "tiktok" && (
            <div className="flex items-center gap-1.5">
              {CONTENT_TYPES.map((type) => {
                const count = typeCounts[type] || 0;
                if (type !== "All" && count === 0) return null;
                const isActive = contentTypeFilter === type;
                return (
                  <button
                    key={type}
                    onClick={() => setContentTypeFilter(type)}
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
            </div>
          )}

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
      {!loading && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            No posts found yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            New posts will appear after the next daily scan.
          </p>
        </div>
      )}

      {/* No filter results */}
      {!loading && posts.length > 0 && filteredPosts.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No posts match your filters
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setContentTypeFilter("All");
            }}
            className="mt-2 text-sm text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Gallery Grid */}
      {!loading && filteredPosts.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filteredPosts.map((post) => (
            <PostGalleryCard
              key={post.id}
              post={post}
              onClick={() => setSelectedPost(post)}
            />
          ))}
        </div>
      )}

      {/* Full View Modal */}
      {selectedPost && (
        <PostFullViewModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
        />
      )}
    </div>
  );
}
