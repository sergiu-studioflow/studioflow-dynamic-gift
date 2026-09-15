"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdCopyConceptCard, type ConceptRow } from "./ad-copy-concept-card";
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
import type { AdCopyRequest } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  processing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const IN_FLIGHT = ["new", "processing"] as const;

export function AdCopyLibrary() {
  const lib = useRequestLibrary<AdCopyRequest, ConceptRow>({
    apiBase: "/api/ad-copy",
    childKey: "concepts",
    inFlightStatuses: IN_FLIGHT,
    childNoun: "concepts",
  });
  const concepts = lib.children;

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
            {lib.clientId ? `No ad copy requests for ${lib.clientName} yet.` : "No ad copy requests yet."} Switch to the
            Generate Ad Copy tab to create your first set.
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
        const angles = Array.isArray(req.angleEmphasis) ? req.angleEmphasis.map(String) : [];
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
                    {req.status === "error" && req.errorMessage ? (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">{req.errorMessage}</p>
                    ) : null}
                    {stuck ? (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
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

            {/* Expanded concepts */}
            {isExpanded && (
              <div className="pl-6 space-y-4">
                {!lib.childrenReady ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : lib.childrenError && concepts.length === 0 ? (
                  <p className="text-sm text-destructive py-4">{lib.childrenError}</p>
                ) : concepts.length === 0 && lib.heldCount === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    {lib.isInFlight(req) && !stuck
                      ? "Ad copy is being generated… this usually takes a minute or two. This list updates by itself."
                      : "No concepts generated yet."}
                  </p>
                ) : (
                  <>
                    <HeldByQcNotice
                      count={lib.heldCount}
                      singular="concept"
                      plural="concepts"
                      showing={lib.showHeld}
                      onToggle={lib.toggleShowHeld}
                    />
                    {concepts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Every concept from this run is held by Quality Control. Use Show held to see them.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {concepts.map((concept) => (
                          <AdCopyConceptCard
                            key={concept.id}
                            concept={concept}
                            onStatusChange={(conceptId, status) => lib.updateChild(conceptId, { status })}
                          />
                        ))}
                      </div>
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
