"use client";

import { Eye, Heart, Play, Layers } from "lucide-react";
import type { OrganicPost } from "./types";
import { formatNumber, isEmptyAiField, timeAgo } from "./utils";

export function PostGalleryCard({
  post,
  onClick,
}: {
  post: OrganicPost;
  onClick: () => void;
}) {
  const angleLabel =
    !isEmptyAiField(post.contentAngle)
      ? post.contentAngle
      : post.caption
      ? post.caption.slice(0, 50) + (post.caption.length > 50 ? "..." : "")
      : "Untitled";

  const bodyText = !isEmptyAiField(post.valueProp)
    ? post.valueProp
    : !isEmptyAiField(post.openingHook)
    ? post.openingHook
    : null;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-xl border border-border bg-card overflow-hidden transition-all hover:shadow-md hover:scale-[1.02]"
    >
      {/* Cover image */}
      <div className="relative aspect-[4/3] bg-muted overflow-hidden">
        <img
          src={post.coverUrl}
          alt={angleLabel || "Post"}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />

        {/* Content type badge — TikTok only */}
        {post.platform === "tiktok" && (
          <div className="absolute top-2 left-2 flex items-center gap-1">
            {post.contentType === "Video" ? (
              <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                <Play className="h-3 w-3" fill="white" />
                Video
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                <Layers className="h-3 w-3" />
                {post.slideCount} slides
              </span>
            )}
          </div>
        )}

        {/* Publish date */}
        <div className="absolute top-2 right-2">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
            {timeAgo(post.publishDate)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Content angle tag */}
        <span className="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary line-clamp-1">
          {angleLabel}
        </span>

        {/* Content mechanic */}
        {!isEmptyAiField(post.contentMechanic) && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {post.contentMechanic}
          </p>
        )}

        {/* Body text */}
        {bodyText && (
          <p className="text-xs text-foreground/80 line-clamp-2">{bodyText}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {formatNumber(post.views)}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" />
            {formatNumber(post.likes)}
          </span>
        </div>
      </div>
    </div>
  );
}
