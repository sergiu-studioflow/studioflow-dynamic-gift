"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Target,
  Type,
  Zap,
  ShieldCheck,
  TestTubes,
  MousePointerClick,
} from "lucide-react";
import type { GeneratedAdCopy } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  new: "text-blue-600 dark:text-blue-400",
  approved: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-red-600 dark:text-red-400",
  saved: "text-purple-600 dark:text-purple-400",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  approved: "Approved",
  rejected: "Rejected",
  saved: "Saved",
};

type AdCopyConceptCardProps = {
  concept: GeneratedAdCopy;
  onStatusChange: (conceptId: string, newStatus: string) => void;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      className="h-6 w-6 p-0"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

function CharBadge({ count, max }: { count: number; max: number }) {
  const ok = count <= max;
  return (
    <span
      className={`text-[10px] font-mono px-1 py-0.5 rounded ${
        ok
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {count}/{max}
    </span>
  );
}

export function AdCopyConceptCard({ concept, onStatusChange }: AdCopyConceptCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [updating, setUpdating] = useState(false);

  async function handleStatusChange(newStatus: string) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/ad-copy/concepts/${concept.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        onStatusChange(concept.id, newStatus);
      }
    } catch {}
    setUpdating(false);
  }

  const anglesUsed = (concept.anglesUsed || []) as string[];
  const headlines = (concept.headlines || []) as { text: string; char_count: number }[];
  const descriptions = (concept.descriptions || []) as { text: string; char_count: number }[];
  const hookLines = (concept.hookLines || []) as { text: string; length_variant: string }[];

  return (
    <Card
      className={`transition-all duration-200 ${
        expanded
          ? "ring-1 ring-primary/30 shadow-md"
          : "hover:border-primary/20 hover:shadow-sm cursor-pointer"
      }`}
    >
      <CardContent className="space-y-3 pt-4 pb-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <Badge variant="secondary" className="text-[11px] px-2 py-0.5 font-bold bg-primary/10 text-primary">
              Concept {concept.conceptNumber}
            </Badge>
            {concept.conceptName && (
              <span className="text-sm font-bold text-foreground">{concept.conceptName}</span>
            )}
            {anglesUsed.map((a) => (
              <Badge
                key={a}
                variant="secondary"
                className="text-[10px] px-1.5 py-0"
              >
                {a}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Select
              value={concept.status}
              onValueChange={handleStatusChange}
              disabled={updating}
            >
              <SelectTrigger
                className={`h-7 w-[100px] text-[11px] font-medium border-0 bg-transparent ${STATUS_STYLES[concept.status] || ""}`}
              >
                <SelectValue>
                  {STATUS_LABELS[concept.status] || concept.status}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="saved">Saved</SelectItem>
              </SelectContent>
            </Select>
            <button onClick={() => setExpanded(!expanded)} className="p-1">
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Strategy (always visible) */}
        {concept.conceptStrategy && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            <Target className="inline h-3 w-3 mr-1 text-primary/60" />
            {concept.conceptStrategy}
          </p>
        )}

        {/* Expanded details */}
        {expanded && (
          <div className="space-y-5 border-t border-border pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* Primary Text Variants */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Type className="h-4 w-4 text-primary/60" />
                <span className="text-xs font-semibold text-foreground">Primary Text</span>
              </div>

              {concept.primaryTextShort && (
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Short (~125 chars)</span>
                    <div className="flex items-center gap-1">
                      <CharBadge count={concept.primaryTextShort.length} max={150} />
                      <CopyButton text={concept.primaryTextShort} />
                    </div>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{concept.primaryTextShort}</p>
                </div>
              )}

              {concept.primaryTextMedium && (
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Medium (~250 chars)</span>
                    <div className="flex items-center gap-1">
                      <CharBadge count={concept.primaryTextMedium.length} max={300} />
                      <CopyButton text={concept.primaryTextMedium} />
                    </div>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{concept.primaryTextMedium}</p>
                </div>
              )}

              {concept.primaryTextLong && (
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Long (~500 chars)</span>
                    <div className="flex items-center gap-1">
                      <CharBadge count={concept.primaryTextLong.length} max={600} />
                      <CopyButton text={concept.primaryTextLong} />
                    </div>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{concept.primaryTextLong}</p>
                </div>
              )}
            </div>

            {/* Headlines */}
            {headlines.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary/60" />
                  <span className="text-xs font-semibold text-foreground">Headlines ({headlines.length})</span>
                </div>
                <div className="space-y-1.5">
                  {headlines.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
                    >
                      <span className="text-sm text-foreground font-medium">{h.text}</span>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <CharBadge count={h.char_count || h.text.length} max={40} />
                        <CopyButton text={h.text} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Descriptions */}
            {descriptions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Type className="h-4 w-4 text-primary/60" />
                  <span className="text-xs font-semibold text-foreground">Descriptions ({descriptions.length})</span>
                </div>
                <div className="space-y-1.5">
                  {descriptions.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
                    >
                      <span className="text-sm text-foreground">{d.text}</span>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <CharBadge count={d.char_count || d.text.length} max={30} />
                        <CopyButton text={d.text} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hook Lines */}
            {hookLines.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary/60" />
                  <span className="text-xs font-semibold text-foreground">Hook Lines</span>
                </div>
                <div className="space-y-1.5">
                  {hookLines.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
                    >
                      <div className="flex-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mr-2">
                          {h.length_variant}
                        </span>
                        <span className="text-sm text-foreground">{h.text}</span>
                      </div>
                      <CopyButton text={h.text} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            {concept.ctaRecommendation && (
              <div className="flex items-center gap-2.5">
                <MousePointerClick className="h-4 w-4 text-primary/60 flex-shrink-0" />
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs font-semibold text-foreground">CTA:</span>
                  <span className="text-sm font-medium text-primary">{concept.ctaRecommendation}</span>
                  <CopyButton text={concept.ctaRecommendation} />
                </div>
              </div>
            )}

            {/* A/B Testing Notes */}
            {concept.abTestingNotes && (
              <div className="flex items-start gap-2.5">
                <TestTubes className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-foreground">A/B Testing Notes</span>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {concept.abTestingNotes}
                  </p>
                </div>
              </div>
            )}

            {/* Compliance */}
            {(concept.complianceStatus !== "passed" || concept.complianceNotes) && (
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">Compliance</span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${
                        concept.complianceStatus === "passed"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {concept.complianceStatus}
                    </Badge>
                  </div>
                  {concept.complianceNotes && (
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {concept.complianceNotes}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
