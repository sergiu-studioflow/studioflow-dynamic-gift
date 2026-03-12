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
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ContentIdea } from "@/lib/types";

const TYPE_COLORS: Record<string, string> = {
  "Review/Testimonial": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "Product Features": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Behind the Scenes": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "Value Prop Reinforcement": "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  "Educational": "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  "Case Study": "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

const PLATFORM_EMOJI: Record<string, string> = {
  Facebook: "f",
  Instagram: "ig",
  LinkedIn: "in",
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
  const [expanded, setExpanded] = useState(false);
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

  return (
    <Card className="transition-all duration-150 hover:border-primary/20">
      <CardContent className="space-y-3 pt-4 pb-3">
        {/* Header: type badge + platform + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[idea.contentType] || ""}`}
            >
              {idea.contentType}
            </Badge>
            <span className="text-[10px] font-mono uppercase text-muted-foreground rounded bg-muted px-1.5 py-0.5">
              {PLATFORM_EMOJI[idea.platformRecommendation] || idea.platformRecommendation}
            </span>
          </div>
          <Select
            value={idea.status}
            onValueChange={handleStatusChange}
            disabled={updating}
          >
            <SelectTrigger
              className={`h-6 w-24 text-[10px] border-0 bg-transparent ${STATUS_STYLES[idea.status] || ""}`}
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

        {/* Hook */}
        <p className="text-sm font-semibold leading-snug text-foreground">
          {idea.hook}
        </p>

        {/* Angle */}
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
          {idea.suggestedAngle}
        </p>

        {/* Expand toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="h-6 px-2 text-[11px] text-muted-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="mr-1 h-3 w-3" />
              Less
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3 w-3" />
              More
            </>
          )}
        </Button>

        {/* Expanded details */}
        {expanded && (
          <div className="space-y-2.5 border-t border-border pt-3 text-xs">
            <div>
              <span className="font-medium text-foreground">Visual Direction:</span>
              <p className="mt-0.5 text-muted-foreground">{idea.visualDirection}</p>
            </div>
            {idea.coreValueProps && (
              <div>
                <span className="font-medium text-foreground">Core Value Props:</span>
                <p className="mt-0.5 text-muted-foreground">{idea.coreValueProps}</p>
              </div>
            )}
            {idea.copyDirection && (
              <div>
                <span className="font-medium text-foreground">Copy Direction:</span>
                <p className="mt-0.5 text-muted-foreground">{idea.copyDirection}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
