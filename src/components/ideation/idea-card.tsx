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
import { Eye, Palette, MessageSquareText, Zap } from "lucide-react";
import type { ContentIdea } from "@/lib/types";

const TYPE_COLORS: Record<string, string> = {
  "Review/Testimonial": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "Product Features": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Behind the Scenes": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "Value Prop Reinforcement": "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  "Educational": "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  "Case Study": "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

const PLATFORM_STYLES: Record<string, { label: string; className: string }> = {
  Facebook: { label: "Facebook", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  Instagram: { label: "Instagram", className: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  LinkedIn: { label: "LinkedIn", className: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
};

const STATUS_STYLES: Record<string, string> = {
  new: "text-muted-foreground",
  approved: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-red-600 dark:text-red-400",
  saved: "text-blue-600 dark:text-blue-400",
};

type IdeaCardProps = {
  idea: ContentIdea;
  onStatusChange: (ideaId: string, newStatus: string) => void;
};

export function IdeaCard({ idea, onStatusChange }: IdeaCardProps) {
  const [updating, setUpdating] = useState(false);

  async function handleStatusChange(newStatus: string) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/ideation/ideas/${idea.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        onStatusChange(idea.id, newStatus);
      }
    } catch {}
    setUpdating(false);
  }

  const platform = PLATFORM_STYLES[idea.platformRecommendation] || {
    label: idea.platformRecommendation,
    className: "bg-muted text-muted-foreground",
  };

  return (
    <Card className="transition-all duration-200 hover:border-primary/20 hover:shadow-md">
      <CardContent className="space-y-4 pt-5 pb-5">
        {/* Header: type badge + platform + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="secondary"
              className={`text-[11px] px-2 py-0.5 font-medium ${TYPE_COLORS[idea.contentType] || ""}`}
            >
              {idea.contentType}
            </Badge>
            <span className={`text-[11px] font-medium rounded-md px-2 py-0.5 ${platform.className}`}>
              {platform.label}
            </span>
          </div>
          <Select
            value={idea.status}
            onValueChange={handleStatusChange}
            disabled={updating}
          >
            <SelectTrigger
              className={`h-7 w-[100px] text-[11px] font-medium border-0 bg-transparent ${STATUS_STYLES[idea.status] || ""}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="saved">Saved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Hook — the headline */}
        <p className="text-[15px] font-bold leading-snug text-foreground tracking-tight">
          &ldquo;{idea.hook}&rdquo;
        </p>

        {/* Suggested Angle — full display */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {idea.suggestedAngle}
        </p>

        {/* Detail sections */}
        <div className="space-y-3 border-t border-border pt-4">
          {/* Visual Direction */}
          {idea.visualDirection && (
            <div className="flex gap-2.5">
              <Palette className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs font-semibold text-foreground">Visual Direction</span>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {idea.visualDirection}
                </p>
              </div>
            </div>
          )}

          {/* Core Value Props */}
          {idea.coreValueProps && (
            <div className="flex gap-2.5">
              <Zap className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs font-semibold text-foreground">Value Props</span>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {idea.coreValueProps}
                </p>
              </div>
            </div>
          )}

          {/* Copy Direction */}
          {idea.copyDirection && (
            <div className="flex gap-2.5">
              <MessageSquareText className="h-4 w-4 text-primary/60 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs font-semibold text-foreground">Copy Direction</span>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {idea.copyDirection}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
