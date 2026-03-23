"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdCopyConceptCard } from "./ad-copy-concept-card";
import {
  Loader2,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import type { AdCopyRequest, GeneratedAdCopy } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  processing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function AdCopyLibrary() {
  const [requests, setRequests] = useState<AdCopyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<GeneratedAdCopy[]>([]);
  const [conceptsLoading, setConceptsLoading] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/ad-copy");
      if (!res.ok) throw new Error("Failed to load");
      setRequests(await res.json());
    } catch {
      setError("Failed to load ad copy requests");
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

  async function loadConcepts(requestId: string) {
    if (expandedId === requestId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(requestId);
    setConceptsLoading(true);
    try {
      const res = await fetch(`/api/ad-copy/${requestId}`);
      if (!res.ok) throw new Error("Failed to load concepts");
      const data = await res.json();
      setConcepts(data.concepts || []);
    } catch {
      setConcepts([]);
    } finally {
      setConceptsLoading(false);
    }
  }

  async function handleDelete(requestId: string) {
    if (!confirm("Delete this request and all its ad copy concepts?")) return;
    try {
      const res = await fetch(`/api/ad-copy/${requestId}`, { method: "DELETE" });
      if (res.ok) {
        setRequests((prev) => prev.filter((r) => r.id !== requestId));
        if (expandedId === requestId) setExpandedId(null);
      }
    } catch {}
  }

  async function handleRetrigger(requestId: string) {
    try {
      const res = await fetch(`/api/ad-copy/${requestId}/trigger`, {
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

  function handleConceptStatusChange(conceptId: string, newStatus: string) {
    setConcepts((prev) =>
      prev.map((c) =>
        c.id === conceptId ? { ...c, status: newStatus } : c
      )
    );
  }

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
            No ad copy requests yet. Switch to the Generate Ad Copy tab to create your first set.
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
        const angles = (req.angleEmphasis || []) as string[];
        return (
          <div key={req.id} className="space-y-3">
            <Card
              className={`cursor-pointer transition-all duration-150 ${
                isExpanded ? "ring-1 ring-primary/30" : "hover:border-primary/20"
              }`}
            >
              <CardContent className="flex items-center gap-4 py-4">
                <button
                  onClick={() => loadConcepts(req.id)}
                  className="flex flex-1 items-center gap-4 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{req.brand}</span>
                      <Badge
                        className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[req.status] || ""}`}
                        variant="secondary"
                      >
                        {req.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{req.campaignObjective}</span>
                      <span className="text-xs text-muted-foreground">{req.adFormat}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {angles.map((a) => (
                        <span
                          key={a}
                          className="text-[10px] rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
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

            {/* Expanded concepts */}
            {isExpanded && (
              <div className="pl-6 space-y-4">
                {conceptsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : concepts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    {req.status === "processing" || req.status === "new"
                      ? "Ad copy is being generated... This may take 60-90 seconds."
                      : "No concepts generated yet."}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {concepts.map((concept) => (
                      <AdCopyConceptCard
                        key={concept.id}
                        concept={concept}
                        onStatusChange={handleConceptStatusChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
