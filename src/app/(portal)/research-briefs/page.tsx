"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useClient } from "@/lib/client-context";
import {
  FileText,
  Video,
  Image as ImageIcon,
  Layers,
  Clock,
  AlertCircle,
  Loader2,
  Target,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type ResearchBriefSummary = {
  id: string;
  sourceType: string;
  sourceId: number;
  title: string;
  mediaType: string;
  creativeFormat: string | null;
  funnelStage: string | null;
  primaryHook: string | null;
  status: string;
  createdAt: string;
};

const mediaTypeIcons: Record<string, typeof Video> = {
  video: Video,
  static: ImageIcon,
  carousel: Layers,
};

const funnelColors: Record<string, string> = {
  TOF: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  MOF: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  BOF: "bg-green-500/10 text-green-500 border-green-500/20",
};

export default function ResearchBriefsPage() {
  const { clientId } = useClient();
  const [briefs, setBriefs] = useState<ResearchBriefSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    const params = new URLSearchParams({ clientId });
    if (filter !== "all") params.set("mediaType", filter);
    fetch(`/api/research-briefs?${params}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setBriefs(data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [clientId, filter]);

  // Auto-refresh generating briefs
  useEffect(() => {
    const hasGenerating = briefs.some((b) => b.status === "generating");
    if (!hasGenerating || !clientId) return;
    const interval = setInterval(() => {
      const params = new URLSearchParams({ clientId });
      if (filter !== "all") params.set("mediaType", filter);
      fetch(`/api/research-briefs?${params}`)
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setBriefs(data); })
        .catch(console.error);
    }, 5000);
    return () => clearInterval(interval);
  }, [briefs, clientId, filter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Creative Briefs</h1>
        <p className="mt-2 text-base text-muted-foreground">
          AI-generated creative briefs from competitor research insights.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Filter row */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {briefs.length} research brief{briefs.length !== 1 ? "s" : ""} from competitor analysis
            </p>
            <div className="flex items-center gap-2">
              {["all", "video", "static", "carousel"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {briefs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">No research briefs yet</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Open any competitor ad or organic post in Competitor Research and click
                &quot;Generate Brief&quot; to create an AI-powered creative brief.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {briefs.map((brief) => {
                const MediaIcon = mediaTypeIcons[brief.mediaType] || FileText;
                const isError = brief.status === "error";
                const isGenerating = brief.status === "generating";

                return (
                  <Link
                    key={brief.id}
                    href={`/research-briefs/${brief.id}`}
                    className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-muted p-1.5">
                          <MediaIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        {brief.funnelStage && (
                          <Badge variant="outline" className={`text-[10px] ${funnelColors[brief.funnelStage] || ""}`}>
                            {brief.funnelStage}
                          </Badge>
                        )}
                        {brief.creativeFormat && (
                          <Badge variant="outline" className="text-[10px]">
                            {brief.creativeFormat}
                          </Badge>
                        )}
                      </div>
                      {isError && <AlertCircle className="h-4 w-4 text-red-500" />}
                      {isGenerating && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                    </div>

                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 mb-2">
                      {brief.title}
                    </h3>

                    {brief.primaryHook && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                        <Sparkles className="inline h-3 w-3 mr-1" />
                        {brief.primaryHook}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground/60 pt-2 border-t border-border/50">
                      <div className="flex items-center gap-1">
                        <Target className="h-3 w-3" />
                        {brief.sourceType === "competitor_ad" ? "Meta Ad" : "Organic Post"}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(brief.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
