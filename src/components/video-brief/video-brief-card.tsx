"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Target,
  FileText,
  Eye,
  Music,
  Users,
  ShieldCheck,
  Lightbulb,
  Camera,
  MapPin,
  Film,
  Zap,
} from "lucide-react";
import type { GeneratedVideoBrief, HookVariation } from "@/lib/types";

const PLATFORM_STYLES: Record<string, { label: string; className: string }> = {
  Facebook: { label: "Facebook", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  Instagram: { label: "Instagram", className: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  LinkedIn: { label: "LinkedIn", className: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
};

const STATUS_STYLES: Record<string, string> = {
  pending_review: "text-amber-600 dark:text-amber-400",
  approved: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-red-600 dark:text-red-400",
  revision_needed: "text-blue-600 dark:text-blue-400",
};

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
  revision_needed: "Revision Needed",
};

type VideoBriefCardProps = {
  brief: GeneratedVideoBrief;
  onStatusChange: (briefId: string, newStatus: string) => void;
};

export function VideoBriefCard({ brief, onStatusChange }: VideoBriefCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);

  async function handleStatusChange(newStatus: string) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/video-brief/briefs/${brief.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        onStatusChange(brief.id, newStatus);
      }
    } catch {}
    setUpdating(false);
  }

  const platform = brief.platform
    ? PLATFORM_STYLES[brief.platform] || { label: brief.platform, className: "bg-muted text-muted-foreground" }
    : null;

  const hookVariations = (brief.hookVariations || []) as HookVariation[];

  return (
    <Card
      className={`transition-all duration-200 cursor-pointer ${
        expanded
          ? "ring-1 ring-primary/30 shadow-md"
          : "hover:border-primary/20 hover:shadow-sm"
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="space-y-3 pt-4 pb-3">
        {/* Header: platform + duration + content type + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {platform && (
              <span className={`text-[11px] font-medium rounded-md px-2 py-0.5 ${platform.className}`}>
                {platform.label}
              </span>
            )}
            {brief.duration && (
              <Badge variant="secondary" className="text-[11px] px-2 py-0.5 font-medium">
                {brief.duration}
              </Badge>
            )}
            {brief.contentType && (
              <Badge
                variant="secondary"
                className="text-[11px] px-2 py-0.5 font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400"
              >
                {brief.contentType}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Select
              value={brief.status}
              onValueChange={handleStatusChange}
              disabled={updating}
            >
              <SelectTrigger
                className={`h-7 w-[130px] text-[11px] font-medium border-0 bg-transparent ${STATUS_STYLES[brief.status] || ""}`}
              >
                <SelectValue>
                  {STATUS_LABELS[brief.status] || brief.status}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="revision_needed">Revision Needed</SelectItem>
              </SelectContent>
            </Select>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Title */}
        {brief.briefTitle && (
          <p className="text-[15px] font-bold leading-snug text-foreground tracking-tight">
            {brief.briefTitle}
          </p>
        )}

        {/* Primary Hook — clamped when collapsed */}
        {brief.primaryHook && (
          <p className={`text-sm text-muted-foreground leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
            &ldquo;{brief.primaryHook}&rdquo;
          </p>
        )}

        {/* Expanded details */}
        {expanded && (
          <div className="space-y-4 border-t border-border pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* Strategic Hypothesis */}
            {brief.strategicHypothesis && (
              <Section icon={Target} label="Strategic Hypothesis" text={brief.strategicHypothesis} />
            )}

            {/* Psychology Angle */}
            {brief.psychologyAngle && (
              <Section icon={Lightbulb} label="Psychology Angle" text={brief.psychologyAngle} />
            )}

            {/* Full Script */}
            {brief.fullScript && (
              <div className="flex gap-2.5">
                <FileText className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <span className="text-xs font-semibold text-foreground">Full Script</span>
                  <pre className="mt-1 max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed font-sans">
                    {brief.fullScript}
                  </pre>
                </div>
              </div>
            )}

            {/* Hook Variations */}
            {hookVariations.length > 0 && (
              <div className="flex gap-2.5">
                <Zap className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <span className="text-xs font-semibold text-foreground">
                    Hook Variations ({hookVariations.length})
                  </span>
                  <div className="space-y-2">
                    {hookVariations.map((hook, i) => (
                      <div key={i} className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {hook.title || `Hook ${i + 1}`}
                          </span>
                          {hook.type && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {hook.type}
                            </Badge>
                          )}
                          {hook.platform_best_fit && (
                            <span className="text-[10px] text-muted-foreground">
                              Best for: {hook.platform_best_fit}
                            </span>
                          )}
                        </div>
                        {hook.text && (
                          <p className="text-xs text-foreground/80">&ldquo;{hook.text}&rdquo;</p>
                        )}
                        {hook.visual && (
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-medium">Visual:</span> {hook.visual}
                          </p>
                        )}
                        {hook.why_it_works && (
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-medium">Why it works:</span> {hook.why_it_works}
                          </p>
                        )}
                        {hook.estimated_stop_rate && (
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-medium">Est. stop rate:</span> {hook.estimated_stop_rate}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Scene Breakdown */}
            {brief.sceneBreakdown && (
              <Section icon={Film} label="Scene Breakdown" text={brief.sceneBreakdown} pre />
            )}

            {/* Shot List */}
            {brief.shotList && (
              <Section icon={Camera} label="Shot List" text={brief.shotList} pre />
            )}

            {/* Visual Direction */}
            {brief.visualDirection && (
              <Section icon={Eye} label="Visual Direction" text={brief.visualDirection} />
            )}

            {/* Audio / Music Direction */}
            {(brief.audioDirection || brief.musicDirection) && (
              <div className="flex gap-2.5">
                <Music className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-foreground">Audio & Music Direction</span>
                  {brief.audioDirection && (
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium">Audio:</span> {brief.audioDirection}
                    </p>
                  )}
                  {brief.musicDirection && (
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium">Music:</span> {brief.musicDirection}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* On-Screen Text */}
            {brief.onScreenText && (
              <Section icon={FileText} label="On-Screen Text" text={brief.onScreenText} />
            )}

            {/* Talent Notes */}
            {brief.talentNotes && (
              <Section icon={Users} label="Talent Notes" text={brief.talentNotes} />
            )}

            {/* Location Requirements */}
            {brief.locationRequirements && (
              <Section icon={MapPin} label="Location Requirements" text={brief.locationRequirements} />
            )}

            {/* B-Roll Guidance */}
            {brief.bRollGuidance && (
              <Section icon={Film} label="B-Roll Guidance" text={brief.bRollGuidance} />
            )}

            {/* Brand Voice Lock */}
            {brief.brandVoiceLock && (
              <Section icon={ShieldCheck} label="Brand Voice Lock" text={brief.brandVoiceLock} />
            )}

            {/* Compliance Notes */}
            {brief.complianceNotes && (
              <Section icon={ShieldCheck} label="Compliance Notes" text={brief.complianceNotes} />
            )}

            {/* AI Generation Notes */}
            {brief.aiGenerationNotes && (
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-[11px] text-muted-foreground italic">{brief.aiGenerationNotes}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  icon: Icon,
  label,
  text,
  pre,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  text: string;
  pre?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      <Icon className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        {pre ? (
          <pre className="mt-1 max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed font-sans">
            {text}
          </pre>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{text}</p>
        )}
      </div>
    </div>
  );
}
