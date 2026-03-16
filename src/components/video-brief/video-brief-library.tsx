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
import { VideoBriefCard } from "./video-brief-card";
import {
  Loader2,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import type { VideoBriefRequest, GeneratedVideoBrief } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  processing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function VideoBriefLibrary() {
  const [requests, setRequests] = useState<VideoBriefRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<GeneratedVideoBrief[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/video-brief");
      if (!res.ok) throw new Error("Failed to load");
      setRequests(await res.json());
    } catch {
      setError("Failed to load video brief requests");
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
      (r) => r.status === "submitted" || r.status === "processing"
    );
    if (!hasProcessing) return;

    const interval = setInterval(loadRequests, 5000);
    return () => clearInterval(interval);
  }, [requests, loadRequests]);

  async function loadBriefs(requestId: string) {
    if (expandedId === requestId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(requestId);
    setBriefsLoading(true);
    try {
      const res = await fetch(`/api/video-brief/${requestId}`);
      if (!res.ok) throw new Error("Failed to load briefs");
      const data = await res.json();
      setBriefs(data.briefs || []);
    } catch {
      setBriefs([]);
    } finally {
      setBriefsLoading(false);
    }
  }

  async function handleDelete(requestId: string) {
    if (!confirm("Delete this request and all its briefs?")) return;
    try {
      const res = await fetch(`/api/video-brief/${requestId}`, { method: "DELETE" });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== requestId));
        if (expandedId === requestId) setExpandedId(null);
      }
    } catch {}
  }

  async function handleRetrigger(requestId: string) {
    try {
      const res = await fetch(`/api/video-brief/${requestId}/trigger`, {
        method: "POST",
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) =>
            r.id === requestId ? { ...r, status: "submitted" } : r
          )
        );
      }
    } catch {}
  }

  function handleBriefStatusChange(briefId: string, newStatus: string) {
    setBriefs((prev) =>
      prev.map((brief) =>
        brief.id === briefId ? { ...brief, status: newStatus } : brief
      )
    );
  }

  const filteredBriefs = briefs.filter((brief) => {
    if (filterPlatform !== "all" && brief.platform !== filterPlatform) return false;
    if (filterStatus !== "all" && brief.status !== filterStatus) return false;
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
            No video brief requests yet. Switch to the Generate Brief tab to create your first brief.
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
                  onClick={() => loadBriefs(req.id)}
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
                      {req.contentType && (
                        <span className="text-xs text-muted-foreground">{req.contentType}</span>
                      )}
                      {req.platform && (
                        <span className="text-xs text-muted-foreground">{req.platform}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {req.scenarioDirection || "No scenario direction"}
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

            {/* Expanded briefs */}
            {isExpanded && (
              <div className="pl-6 space-y-4">
                {briefsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : briefs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    {req.status === "processing" || req.status === "submitted"
                      ? "Brief is being generated... This may take 60-90 seconds."
                      : "No briefs generated yet."}
                  </p>
                ) : (
                  <>
                    {/* Filters */}
                    <div className="flex flex-wrap gap-2">
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
                        <SelectTrigger className="w-40 h-8 text-xs">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="pending_review">Pending Review</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                          <SelectItem value="revision_needed">Revision Needed</SelectItem>
                        </SelectContent>
                      </Select>

                      <span className="text-xs text-muted-foreground self-center">
                        {filteredBriefs.length} of {briefs.length} briefs
                      </span>
                    </div>

                    {/* Brief cards */}
                    <div className="grid grid-cols-1 gap-3">
                      {filteredBriefs.map((brief) => (
                        <VideoBriefCard
                          key={brief.id}
                          brief={brief}
                          onStatusChange={handleBriefStatusChange}
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
