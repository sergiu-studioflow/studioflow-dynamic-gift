"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IdeaCard } from "./idea-card";
import {
  Loader2,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import type { IdeationRequest, ContentIdea } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  processing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function IdeaLibrary() {
  const [requests, setRequests] = useState<IdeationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/ideation");
      if (!res.ok) throw new Error("Failed to load");
      setRequests(await res.json());
    } catch {
      setError("Failed to load ideation requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Auto-refresh processing requests
  useEffect(() => {
    const hasProcessing = requests.some(
      (r) => r.status === "new" || r.status === "processing"
    );
    if (!hasProcessing) return;

    const interval = setInterval(loadRequests, 5000);
    return () => clearInterval(interval);
  }, [requests, loadRequests]);

  async function loadIdeas(requestId: string) {
    if (expandedId === requestId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(requestId);
    setIdeasLoading(true);
    try {
      const res = await fetch(`/api/ideation/${requestId}`);
      if (!res.ok) throw new Error("Failed to load ideas");
      const data = await res.json();
      setIdeas(data.ideas || []);
    } catch {
      setIdeas([]);
    } finally {
      setIdeasLoading(false);
    }
  }

  async function handleDelete(requestId: string) {
    if (!confirm("Delete this request and all its ideas?")) return;
    try {
      const res = await fetch(`/api/ideation/${requestId}`, { method: "DELETE" });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== requestId));
        if (expandedId === requestId) setExpandedId(null);
      }
    } catch {}
  }

  async function handleRetrigger(requestId: string) {
    try {
      const res = await fetch(`/api/ideation/${requestId}/trigger`, {
        method: "POST",
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === requestId ? { ...r, status: "new" } : r
          )
        );
      }
    } catch {}
  }

  function handleIdeaStatusChange(ideaId: string, newStatus: string) {
    setIdeas((prev) =>
      prev.map((idea) =>
        idea.id === ideaId ? { ...idea, status: newStatus } : idea
      )
    );
  }

  const filteredIdeas = ideas.filter((idea) => {
    if (filterType !== "all" && idea.contentType !== filterType) return false;
    if (filterPlatform !== "all" && idea.platformRecommendation !== filterPlatform)
      return false;
    if (filterStatus !== "all" && idea.status !== filterStatus) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (requests.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            No ideation requests yet. Switch to the Generate Ideas tab to create your first batch.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {/* Refresh button */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={loadRequests}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Request list */}
      {requests.map((req) => {
        const isExpanded = expandedId === req.id;
        return (
          <div key={req.id} className="space-y-3">
            <Card
              className={`cursor-pointer transition-all duration-150 ${
                isExpanded ? "ring-1 ring-primary/30" : "hover:border-primary/20"
              }`}
            >
              <CardContent className="flex items-center gap-4 py-4">
                <button
                  onClick={() => loadIdeas(req.id)}
                  className="flex flex-1 items-center gap-4 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{req.brand}</span>
                      <Badge
                        className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[req.status] || ""}`}
                        variant="secondary"
                      >
                        {req.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {req.numberOfIdeas} ideas
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {req.direction}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </span>
                </button>

                <div className="flex gap-1 flex-shrink-0">
                  {(req.status === "error" || req.status === "complete") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetrigger(req.id);
                      }}
                      title="Re-generate"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(req.id);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Expanded ideas */}
            {isExpanded && (
              <div className="pl-6 space-y-4">
                {ideasLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : ideas.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    {req.status === "processing" || req.status === "new"
                      ? "Ideas are being generated... This may take 30-60 seconds."
                      : "No ideas generated yet."}
                  </p>
                ) : (
                  <>
                    {/* Filters */}
                    <div className="flex flex-wrap gap-2">
                      <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger className="w-48 h-8 text-xs">
                          <SelectValue placeholder="Content Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="Review/Testimonial">Review/Testimonial</SelectItem>
                          <SelectItem value="Product Features">Product Features</SelectItem>
                          <SelectItem value="Behind the Scenes">Behind the Scenes</SelectItem>
                          <SelectItem value="Value Prop Reinforcement">Value Prop</SelectItem>
                          <SelectItem value="Educational">Educational</SelectItem>
                          <SelectItem value="Case Study">Case Study</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={filterPlatform} onValueChange={setFilterPlatform}>
                        <SelectTrigger className="w-36 h-8 text-xs">
                          <SelectValue placeholder="Platform" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Platforms</SelectItem>
                          <SelectItem value="Facebook">Facebook</SelectItem>
                          <SelectItem value="Instagram">Instagram</SelectItem>
                          <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="new">New</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                          <SelectItem value="saved">Saved</SelectItem>
                        </SelectContent>
                      </Select>

                      <span className="text-xs text-muted-foreground self-center">
                        {filteredIdeas.length} of {ideas.length} ideas
                      </span>
                    </div>

                    {/* Idea cards grid */}
                    <div className="grid grid-cols-1 gap-4">
                      {filteredIdeas.map((idea) => (
                        <IdeaCard
                          key={idea.id}
                          idea={idea}
                          onStatusChange={handleIdeaStatusChange}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
