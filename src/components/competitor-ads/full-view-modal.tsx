"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, ChevronLeft, ChevronRight, X, AlertCircle, Trophy, Loader2, CheckCircle2, FileText } from "lucide-react";
import { useClient } from "@/lib/client-context";
import type { CompetitorAd } from "./types";
import { computeBadge, parseIsoDateUTC, parseMedia } from "./utils";

export function FullViewModal({
  ad,
  onClose,
}: {
  ad: CompetitorAd;
  onClose: () => void;
}) {
  const { clientId } = useClient();
  const [cardIndex, setCardIndex] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [briefId, setBriefId] = useState<string | null>(null);

  // Reset saved state when switching carousel cards
  useEffect(() => { setSaved(false); }, [cardIndex]);

  const media = parseMedia(ad.fullMediaAsset);
  const isCarousel = media?.type === "carousel";
  const cards = isCarousel ? media.cards : [];
  const currentCard = isCarousel ? cards[cardIndex] : null;

  // Override fields for carousel
  const displayAngle = currentCard?.creative_angle ?? ad.creativeAngle;
  const displayDesc = currentCard?.ad_description ?? ad.adDescription;
  const displayPersona = currentCard?.target_persona ?? ad.targetPersona;
  const displayMotivation = currentCard?.core_motivation ?? ad.coreMotivation;
  const displayProof = currentCard?.proof_mechanism ?? ad.proofMechanism;
  const displayVisualHook = currentCard?.visual_hook ?? ad.visualHook;
  const displaySpokenHook = currentCard?.spoken_hook ?? ad.spokenHook;
  const displayOutro = currentCard?.outro_offer ?? ad.outroOffer;
  const displayTranscript = currentCard?.full_transcript ?? ad.fullTranscript;
  const displayHeadline = currentCard?.title ?? ad.headlineTitle;
  const displayPrimaryText = currentCard?.body ?? ad.displayPrimaryText;
  const displayDestUrl = currentCard?.link_url ?? ad.destinationUrl;
  const displayCta = currentCard?.cta_text ?? ad.ctaButtonType;

  let displayDomain = ad.displayDomain;
  if (currentCard?.link_url) {
    try {
      displayDomain = new URL(currentCard.link_url).hostname.replace("www.", "");
    } catch {}
  }

  const badge = computeBadge(ad.snapshotDate, ad.adStartDate);
  const snapshotFormatted = parseIsoDateUTC(ad.snapshotDate).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Determine if the current view is a saveable image
  const isCarouselImage = isCarousel && currentCard && !(currentCard.video_hd_url || currentCard.video_sd_url);
  const isSaveableImage = media?.type === "image" || isCarouselImage;
  const saveableImageUrl = media?.type === "image"
    ? media.url
    : isCarouselImage
      ? (currentCard!.image_url || currentCard!.thumbnail || "")
      : "";

  async function handleSaveToWinners() {
    if (saving || saved || !saveableImageUrl) return;
    setSaving(true);
    try {
      const res = await fetch("/api/winners/save-from-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: saveableImageUrl,
          name: `${ad.brandPageName} - ${displayAngle || displayHeadline || "Ad"}`,
          brandName: ad.brandPageName,
          clientId,
        }),
      });
      if (res.ok) setSaved(true);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateBrief() {
    if (briefing || briefId) return;
    setBriefing(true);
    try {
      const res = await fetch("/api/research-briefs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "competitor_ad",
          sourceId: ad.id,
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

  function renderMediaPlayer() {
    if (!media) {
      return (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-muted p-6">
          <p className="text-center text-sm text-muted-foreground whitespace-pre-wrap">
            {ad.displayPrimaryText || "Text ad — no media"}
          </p>
        </div>
      );
    }

    if (mediaError) {
      return (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg bg-muted p-6">
          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Media unavailable</p>
          {ad.adLibraryUrl && (
            <a href={ad.adLibraryUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
              View original in Ad Library <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      );
    }

    if (media.type === "video") {
      return (
        <video
          src={media.video_hd_url || media.video_sd_url}
          poster={media.thumbnail}
          controls
          className="w-full rounded-lg"
          preload="metadata"
          onError={() => setMediaError(true)}
        />
      );
    }

    if (media.type === "image") {
      return (
        <img
          src={media.url}
          alt={displayAngle || "Ad image"}
          className="w-full rounded-lg"
          onError={() => setMediaError(true)}
        />
      );
    }

    if (media.type === "carousel" && currentCard) {
      const hasVideo = currentCard.video_hd_url || currentCard.video_sd_url;
      return (
        <div className="relative">
          {hasVideo ? (
            <video
              key={cardIndex}
              src={currentCard.video_hd_url || currentCard.video_sd_url || ""}
              poster={currentCard.thumbnail || ""}
              controls
              className="w-full rounded-lg"
              preload="metadata"
              onError={() => setMediaError(true)}
            />
          ) : (
            <img
              src={currentCard.image_url || currentCard.thumbnail || ""}
              alt={`Card ${cardIndex + 1}`}
              className="w-full rounded-lg"
              onError={() => setMediaError(true)}
            />
          )}
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              onClick={() => setCardIndex(Math.max(0, cardIndex - 1))}
              disabled={cardIndex === 0}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-xs font-medium text-muted-foreground">
              Card {cardIndex + 1} of {cards.length}
            </span>
            <button
              onClick={() => setCardIndex(Math.min(cards.length - 1, cardIndex + 1))}
              disabled={cardIndex === cards.length - 1}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-2 flex justify-center gap-1.5">
            {cards.map((_, i) => (
              <button
                key={i}
                onClick={() => setCardIndex(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === cardIndex ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 md:p-8">
      <div className="relative w-full max-w-4xl rounded-2xl border border-border bg-background shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid gap-8 p-6 md:grid-cols-[1fr_1fr] md:p-8">
          {/* Left: Media */}
          <div className="space-y-4">{renderMediaPlayer()}</div>

          {/* Right: Details */}
          <div className="space-y-6 overflow-y-auto max-h-[80vh]">
            {/* Section A: Overview */}
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">
                {displayAngle || displayHeadline || "Ad Details"}
              </h2>
              {displayDesc && <p className="text-sm text-muted-foreground">{displayDesc}</p>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{ad.brandPageName}</span>
                <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
                <span>{badge.days} days at fetch</span>
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                Fetched {snapshotFormatted} — {badge.days} days old at fetch
              </p>
            </div>

            {/* Section B: Strategy */}
            {(displayPersona || displayMotivation || displayProof) && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strategy</h3>
                <div className="space-y-1.5">
                  {displayPersona && (
                    <div className="flex gap-2 text-sm">
                      <span className="shrink-0 font-medium text-muted-foreground">Audience:</span>
                      <span className="text-foreground">{displayPersona}</span>
                    </div>
                  )}
                  {displayMotivation && (
                    <div className="flex gap-2 text-sm">
                      <span className="shrink-0 font-medium text-muted-foreground">Motivation:</span>
                      <span className="text-foreground">{displayMotivation}</span>
                    </div>
                  )}
                  {displayProof && (
                    <div className="flex gap-2 text-sm">
                      <span className="shrink-0 font-medium text-muted-foreground">Proof:</span>
                      <span className="text-foreground">{displayProof}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section C: Hooks */}
            {(displayVisualHook || displaySpokenHook) && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hooks</h3>
                <div className="space-y-1.5">
                  {displayVisualHook && (
                    <div className="text-sm">
                      <span className="font-medium text-muted-foreground">Visual: </span>
                      <span className="text-foreground">{displayVisualHook}</span>
                    </div>
                  )}
                  {displaySpokenHook && (
                    <div className="text-sm">
                      <span className="font-medium text-muted-foreground">Spoken: </span>
                      <span className="text-foreground">{displaySpokenHook}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section D: Closing */}
            {displayOutro && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Closing</h3>
                <p className="text-sm text-foreground">{displayOutro}</p>
              </div>
            )}

            {/* Section E: Transcript (collapsible) */}
            {displayTranscript && (
              <div className="space-y-2">
                <button
                  onClick={() => setTranscriptOpen(!transcriptOpen)}
                  className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  Transcript {transcriptOpen ? "▾" : "▸"}
                </button>
                {transcriptOpen && (
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm text-foreground">
                    {displayTranscript}
                  </p>
                )}
              </div>
            )}

            {/* Section F: Funnel & Copy */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funnel & Copy</h3>
              <div className="space-y-1.5 text-sm">
                {displayHeadline && (
                  <div>
                    <span className="font-medium text-muted-foreground">Headline: </span>
                    <span className="text-foreground">{displayHeadline}</span>
                  </div>
                )}
                {displayPrimaryText && (
                  <div>
                    <span className="font-medium text-muted-foreground">Copy: </span>
                    <span className="text-foreground line-clamp-3">{displayPrimaryText}</span>
                  </div>
                )}
                {displayCta && (
                  <div>
                    <span className="font-medium text-muted-foreground">CTA: </span>
                    <span className="text-foreground">{displayCta}</span>
                  </div>
                )}
                {displayDestUrl && (
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-muted-foreground">Landing: </span>
                    <a href={displayDestUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                      {displayDomain}
                    </a>
                  </div>
                )}
                <div>
                  <span className="font-medium text-muted-foreground">DCO: </span>
                  <span className="text-foreground">{ad.isDco ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            {/* Section G: Metadata */}
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {ad.platformsDisplay && <span>{ad.platformsDisplay}</span>}
                {ad.adLibraryUrl && (
                  <a href={ad.adLibraryUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    View in Ad Library <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {isSaveableImage && (
                  <button
                    onClick={handleSaveToWinners}
                    disabled={saving || saved}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      saved
                        ? "bg-green-500/10 text-green-500"
                        : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                    } disabled:opacity-60`}
                  >
                    {saving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : saved ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <Trophy className="h-3 w-3" />
                    )}
                    {saved ? "Saved!" : "Save to Winners"}
                  </button>
                )}
                {briefId ? (
                  <a
                    href="/research-briefs"
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    View Brief
                  </a>
                ) : (
                  <button
                    onClick={handleGenerateBrief}
                    disabled={briefing}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors disabled:opacity-60"
                  >
                    {briefing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {briefing ? "Generating..." : "Generate Brief"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
