"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Play, Image as ImageIcon, Layout, FileText } from "lucide-react";
import type { CompetitorAd } from "./types";
import { computeBadge } from "./utils";

function formatIcon(type: string) {
  switch (type) {
    case "Video": return <Play className="h-3 w-3" />;
    case "Image": return <ImageIcon className="h-3 w-3" />;
    case "Carousel": return <Layout className="h-3 w-3" />;
    case "Text": return <FileText className="h-3 w-3" />;
    default: return null;
  }
}

function ThumbnailFallback({ ad }: { ad: CompetitorAd }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
      <div className="rounded-full bg-muted-foreground/10 p-3">
        {ad.mediaType === "Video" ? <Play className="h-5 w-5 text-muted-foreground/50" /> :
         ad.mediaType === "Carousel" ? <Layout className="h-5 w-5 text-muted-foreground/50" /> :
         <ImageIcon className="h-5 w-5 text-muted-foreground/50" />}
      </div>
      <p className="line-clamp-2 text-center text-xs text-muted-foreground">
        {ad.creativeAngle || ad.headlineTitle || ad.displayPrimaryText?.slice(0, 60) || "Media unavailable"}
      </p>
    </div>
  );
}

export function GalleryCard({
  ad,
  onClick,
}: {
  ad: CompetitorAd;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const badge = computeBadge(ad.snapshotDate, ad.adStartDate);
  const title = ad.creativeAngle || ad.headlineTitle || "Untitled Ad";

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/20"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {ad.primaryThumbnail && !imgError ? (
          <img
            src={ad.primaryThumbnail}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : ad.primaryThumbnail === null && ad.mediaType === "Text" ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="line-clamp-4 text-center text-sm text-muted-foreground">
              {ad.displayPrimaryText || "Text Ad"}
            </p>
          </div>
        ) : (
          <ThumbnailFallback ad={ad} />
        )}

        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {formatIcon(ad.mediaType)}
          <span>{ad.mediaType}</span>
        </div>

        <div className="absolute right-2 top-2">
          <Badge variant={badge.variant} className="text-[10px]">
            {badge.label}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{ad.brandPageName}</p>
        {ad.platformsDisplay && (
          <p className="text-[10px] text-muted-foreground/70">{ad.platformsDisplay}</p>
        )}
      </div>
    </button>
  );
}
