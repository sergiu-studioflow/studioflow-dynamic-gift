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
import { VideoBriefCard, type BriefRow } from "./video-brief-card";
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
import type { VideoBriefRequest } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  new: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  processing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
};

// Portal-created briefs start as 'submitted' (what a restart sets); the n8n docs call it 'new'.
const IN_FLIGHT = ["submitted", "new", "processing"] as const;

export function VideoBriefLibrary() {
  const lib = useRequestLibrary<VideoBriefRequest, BriefRow>({
    apiBase: "/api/video-brief",
    childKey: "briefs",
    inFlightStatuses: IN_FLIGHT,
    childNoun: "briefs",
  });
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const briefs = lib.children;
  const filteredBriefs = briefs.filter((brief) => {
    if (filterPlatform !== "all" && brief.platform !== filterPlatform) return false;
    if (filterStatus !== "all" && brief.status !== filterStatus) return false;
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
            {lib.clientId ? `No video brief requests for ${lib.clientName} yet.` : "No video brief requests yet."} Switch
            to the Generate Brief tab to create your first brief.
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

            {/* Expanded briefs */}
            {isExpanded && (
              <div className="pl-6 space-y-4">
                {!lib.childrenReady ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : lib.childrenError && briefs.length === 0 ? (
                  <p className="text-sm text-destructive py-4">{lib.childrenError}</p>
                ) : briefs.length === 0 && lib.heldCount === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    {lib.isInFlight(req) && !stuck
                      ? "The brief is being generated… this usually takes 5–10 minutes. This list updates by itself."
                      : "No briefs generated yet."}
                  </p>
                ) : (
                  <>
                    <HeldByQcNotice
                      count={lib.heldCount}
                      singular="brief"
                      plural="briefs"
                      showing={lib.showHeld}
                      onToggle={lib.toggleShowHeld}
                    />

                    {briefs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Every brief from this run is held by Quality Control. Use Show held to see them.
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
                              onStatusChange={(briefId, status) => lib.updateChild(briefId, { status })}
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
