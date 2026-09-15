"use client";

import { useState } from "react";
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
import { IdeaCard, type IdeaRow } from "./idea-card";
import { HeldByQcNotice } from "@/components/shared/held-by-qc-notice";
import { useRequestLibrary } from "@/components/shared/use-request-library";
import {
  Loader2,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import type { IdeationRequest } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  processing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const IN_FLIGHT = ["new", "processing"] as const;

export function IdeaLibrary() {
  const lib = useRequestLibrary<IdeationRequest, IdeaRow>({
    apiBase: "/api/ideation",
    childKey: "ideas",
    inFlightStatuses: IN_FLIGHT,
    childNoun: "ideas",
  });
  const [filterType, setFilterType] = useState("all");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const ideas = lib.children;
  const filteredIdeas = ideas.filter((idea) => {
    if (filterType !== "all" && idea.contentType !== filterType) return false;
    if (filterPlatform !== "all" && idea.platformRecommendation !== filterPlatform)
      return false;
    if (filterStatus !== "all" && idea.status !== filterStatus) return false;
    return true;
  });

  if (lib.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (lib.error && lib.requests.length === 0) {
    return (
      <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {lib.error}
      </p>
    );
  }

  if (lib.requests.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            {lib.clientId ? `No ideation requests for ${lib.clientName} yet.` : "No ideation requests yet."} Switch to
            the Generate Ideas tab to create your first batch.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {/* Scope + refresh */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {lib.clientId ? `Showing ${lib.clientName} requests` : "Showing requests for all brands"}
        </p>
        <Button variant="ghost" size="sm" onClick={lib.refresh}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>
      {lib.error ? <p className="text-xs text-destructive">{lib.error}</p> : null}

      {/* Request list */}
      {lib.requests.map((req) => {
        const isExpanded = lib.expandedId === req.id;
        const stuck = lib.isStuck(req);
        const busy = lib.busyId === req.id;
        return (
          <div key={req.id} className="space-y-3">
            <Card
              className={`cursor-pointer transition-all duration-150 ${
                isExpanded ? "ring-1 ring-primary/30" : "hover:border-primary/20"
              }`}
            >
              <CardContent className="flex items-center gap-4 py-4">
                <button
                  onClick={() => lib.toggleExpand(req.id)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
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
                    {req.status === "error" && req.errorMessage ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{req.errorMessage}</p>
                    ) : null}
                    {stuck ? (
                      <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                        No result after 20+ minutes — this run looks stuck. Use Retry to run it again.
                      </p>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(req.createdAt).toLocaleDateString()}
                  </span>
                </button>

                <div className="flex gap-1 flex-shrink-0">
                  {lib.canRetry(req) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        lib.retrigger(req);
                      }}
                      title={req.status === "complete" ? "Re-generate" : "Retry"}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      lib.remove(req);
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
                {!lib.childrenReady ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : lib.childrenError && ideas.length === 0 ? (
                  <p className="text-sm text-destructive py-4">{lib.childrenError}</p>
                ) : ideas.length === 0 && lib.heldCount === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    {lib.isInFlight(req) && !stuck
                      ? "Ideas are being generated… a full batch usually takes 5–10 minutes. This list updates by itself."
                      : "No ideas generated yet."}
                  </p>
                ) : (
                  <>
                    <HeldByQcNotice
                      count={lib.heldCount}
                      singular="idea"
                      plural="ideas"
                      showing={lib.showHeld}
                      onToggle={lib.toggleShowHeld}
                    />

                    {ideas.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Every idea from this run is held by Quality Control. Use Show held to see them.
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
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          {filteredIdeas.map((idea) => (
                            <IdeaCard
                              key={idea.id}
                              idea={idea}
                              onStatusChange={(ideaId, status) => lib.updateChild(ideaId, { status })}
                            />
                          ))}
                        </div>
                      </>
                    )}
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
