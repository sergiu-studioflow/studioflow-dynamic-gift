"use client";

import { useState } from "react";
import {
  X,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Music,
  FileText,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useClient } from "@/lib/client-context";
import type { OrganicPost } from "./types";
import {
  formatNumber,
  formatDuration,
  isEmptyAiField,
  parseSlideImages,
  timeAgo,
} from "./utils";

function AiField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (isEmptyAiField(value)) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function PostFullViewModal({
  post,
  onClose,
}: {
  post: OrganicPost;
  onClose: () => void;
}) {
  const { clientId } = useClient();
  const slides = parseSlideImages(post.slideImages);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showCaption, setShowCaption] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [briefId, setBriefId] = useState<string | null>(null);

  const isCarousel = post.contentType === "Carousel" && slides.length > 0;

  async function handleGenerateBrief() {
    if (briefing || briefId) return;
    setBriefing(true);
    try {
      const res = await fetch("/api/research-briefs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "organic_post",
          sourceId: post.id,
          clientId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBriefId(data.id);
      }
    } catch {
      // silently fail
    } finally {
      setBriefing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-background border border-border shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-background/80 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Section A — Overview / Media */}
        <div className="p-6 space-y-4">
          {/* Media player */}
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            {isCarousel ? (
              <>
                <img
                  src={slides[currentSlide]}
                  alt={`Slide ${currentSlide + 1}`}
                  className="h-full w-full object-contain"
                />
                {slides.length > 1 && (
                  <>
                    <button
                      onClick={() =>
                        setCurrentSlide((prev) =>
                          prev > 0 ? prev - 1 : slides.length - 1
                        )
                      }
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() =>
                        setCurrentSlide((prev) =>
                          prev < slides.length - 1 ? prev + 1 : 0
                        )
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
                      {currentSlide + 1} / {slides.length}
                    </div>
                  </>
                )}
              </>
            ) : post.videoUrl ? (
              <video
                src={post.videoUrl}
                poster={post.coverUrl}
                controls
                className="h-full w-full"
                preload="metadata"
              />
            ) : (
              <img
                src={post.coverUrl}
                alt="Post cover"
                className="h-full w-full object-contain"
              />
            )}
          </div>

          {/* Title row */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              {!isEmptyAiField(post.contentAngle) && (
                <h2 className="text-lg font-bold text-foreground">
                  {post.contentAngle}
                </h2>
              )}
              {!isEmptyAiField(post.contentMechanic) && (
                <p className="text-sm text-muted-foreground">
                  {post.contentMechanic}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {post.videoDuration != null && !isCarousel && (
                <Badge variant="outline" className="text-xs">
                  {formatDuration(post.videoDuration)}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date(post.publishDate).toLocaleDateString()}
              </span>
              <a
                href={post.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
              {briefId ? (
                <a
                  href="/research-briefs"
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  View Brief
                </a>
              ) : (
                <button
                  onClick={handleGenerateBrief}
                  disabled={briefing}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors disabled:opacity-60"
                >
                  {briefing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  {briefing ? "Generating..." : "Generate Brief"}
                </button>
              )}
            </div>
          </div>

          {/* Caption */}
          {post.caption && (
            <div>
              <p
                className={`text-sm text-foreground/80 ${
                  !showCaption && post.caption.length > 200 ? "line-clamp-3" : ""
                }`}
              >
                {post.caption}
              </p>
              {post.caption.length > 200 && (
                <button
                  onClick={() => setShowCaption(!showCaption)}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  {showCaption ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Section B — Engagement */}
        <div className="px-6 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Engagement
          </h3>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2 text-sm">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{formatNumber(post.views)}</span>
              <span className="text-muted-foreground">views</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Heart className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{formatNumber(post.likes)}</span>
              <span className="text-muted-foreground">likes</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{formatNumber(post.comments)}</span>
              <span className="text-muted-foreground">comments</span>
            </div>
            {post.shares != null && (
              <div className="flex items-center gap-2 text-sm">
                <Share2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{formatNumber(post.shares)}</span>
                <span className="text-muted-foreground">shares</span>
              </div>
            )}
            {post.saves != null && (
              <div className="flex items-center gap-2 text-sm">
                <Bookmark className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{formatNumber(post.saves)}</span>
                <span className="text-muted-foreground">saves</span>
              </div>
            )}
          </div>
        </div>

        {/* Section C — Hooks */}
        {(!isEmptyAiField(post.openingHook) ||
          !isEmptyAiField(post.visualHook)) && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Hooks
              </h3>
              <dl className="space-y-3">
                <AiField label="Opening Hook" value={post.openingHook} />
                <AiField label="Visual Hook" value={post.visualHook} />
              </dl>
            </div>
          </>
        )}

        {/* Section D — Strategy */}
        {(!isEmptyAiField(post.targetViewer) ||
          !isEmptyAiField(post.valueProp) ||
          !isEmptyAiField(post.contentStructure) ||
          !isEmptyAiField(post.retentionDriver)) && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Strategy
              </h3>
              <dl className="space-y-3">
                <AiField label="Target Viewer" value={post.targetViewer} />
                <AiField label="Value Proposition" value={post.valueProp} />
                <AiField label="Content Structure" value={post.contentStructure} />
                <AiField label="Retention Driver" value={post.retentionDriver} />
              </dl>
            </div>
          </>
        )}

        {/* Section E — Closing */}
        {!isEmptyAiField(post.outroCta) && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Closing
              </h3>
              <dl>
                <AiField label="Outro CTA" value={post.outroCta} />
              </dl>
            </div>
          </>
        )}

        {/* Section F — Transcript */}
        {!isEmptyAiField(post.fullTranscript) && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-4">
              <button
                onClick={() => setShowTranscript(!showTranscript)}
                className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                <span>Transcript</span>
                {showTranscript ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showTranscript && (
                <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/80">
                  {post.fullTranscript}
                </p>
              )}
            </div>
          </>
        )}

        {/* Section G — Music & Metadata */}
        {(post.musicName || post.hashtags) && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Music & Metadata
              </h3>
              {post.musicName && (
                <div className="flex items-center gap-2 text-sm">
                  <Music className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {post.musicName}
                    {post.musicAuthor ? ` — ${post.musicAuthor}` : ""}
                  </span>
                  {post.musicIsOriginal != null && (
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                    >
                      {post.musicIsOriginal ? "Original Audio" : "Licensed Audio"}
                    </Badge>
                  )}
                </div>
              )}
              {post.hashtags && post.hashtags.trim() && (
                <div className="flex flex-wrap gap-1.5">
                  {post.hashtags.split(",").map((tag, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground/60">
                Ingested {timeAgo(post.ingestedAt)}
              </p>
            </div>
          </>
        )}

        {/* AI error banner */}
        {post.aiAnalysisStatus === "Error" && (
          <>
            <div className="border-t border-border" />
            <div className="px-6 py-3 bg-red-50 dark:bg-red-500/10 text-sm text-red-600 dark:text-red-400">
              AI analysis failed for this post.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
