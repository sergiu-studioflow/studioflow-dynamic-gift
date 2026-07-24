/**
 * Source loaders for the posting queue.
 *
 * Each content system that can feed the scheduler has a loader here. A loader
 * validates the source is publishable, resolves the client, picks the media URL,
 * and builds a `source_snapshot` that survives later deletion of the source row.
 *
 * `review_graphic` is special: it already carries per-platform captions + one
 * asset per format, so it skips Claude caption generation entirely.
 */

import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export type SourceType = "static_ad" | "winner" | "video" | "review_graphic";

export type LoadedSource = {
  clientId: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  snapshot: Record<string, unknown>;
  fkColumn: "sourceGenerationId" | "sourceWinnerId" | "sourceVideoId" | "sourceReviewGraphicId";
  /** Present only for review_graphic — pre-made captions (skip Claude). */
  reviewCaptions?: {
    instagram: string;
    facebook: string;
    story: string;
    hashtags: string[];
  };
  /** Present only for review_graphic — one image per platform format. */
  reviewAssets?: { ig_feed?: string; story?: string; fb?: string };
};

export class SourceError extends Error {}

export async function loadSource(sourceType: SourceType, sourceId: string): Promise<LoadedSource> {
  switch (sourceType) {
    case "static_ad":
      return loadStaticAd(sourceId);
    case "winner":
      return loadWinner(sourceId);
    case "video":
      return loadVideo(sourceId);
    case "review_graphic":
      return loadReviewGraphic(sourceId);
    default:
      throw new SourceError(`Unknown source type: ${sourceType}`);
  }
}

async function loadStaticAd(id: string): Promise<LoadedSource> {
  const [row] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, id))
    .limit(1);
  if (!row) throw new SourceError("Static ad not found");
  if (row.status !== "completed" && row.status !== "complete") {
    throw new SourceError(`Static ad is not completed (status: ${row.status})`);
  }
  if (!row.imageUrl) throw new SourceError("Static ad has no image");
  if (!row.clientId) throw new SourceError("Static ad has no client");
  return {
    clientId: row.clientId,
    mediaType: "image",
    mediaUrl: row.imageUrl,
    fkColumn: "sourceGenerationId",
    snapshot: {
      kind: "static_ad",
      name: row.styleName || row.productName || "Static ad",
      productName: row.productName,
      adCopy: row.adCopy,
      aspectRatio: row.aspectRatio,
      finalPromptExcerpt: (row.finalPrompt || "").slice(0, 600),
    },
  };
}

async function loadWinner(id: string): Promise<LoadedSource> {
  const [row] = await db
    .select()
    .from(schema.winnersLibrary)
    .where(eq(schema.winnersLibrary.id, id))
    .limit(1);
  if (!row) throw new SourceError("Winner not found");
  if (!row.imageUrl) throw new SourceError("Winner has no image");
  if (!row.clientId) throw new SourceError("Winner has no client");
  return {
    clientId: row.clientId,
    mediaType: "image",
    mediaUrl: row.imageUrl,
    fkColumn: "sourceWinnerId",
    snapshot: {
      kind: "winner",
      name: row.name,
      productName: row.productName,
      tags: row.tags,
      notes: row.notes,
    },
  };
}

async function loadVideo(id: string): Promise<LoadedSource> {
  const [row] = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id))
    .limit(1);
  if (!row) throw new SourceError("Video not found");
  if (row.status !== "completed" && row.status !== "complete") {
    throw new SourceError(`Video is not completed (status: ${row.status})`);
  }
  if (!row.videoUrl) throw new SourceError("Video has no output");
  if (!row.clientId) throw new SourceError("Video has no client");
  return {
    clientId: row.clientId,
    mediaType: "video",
    mediaUrl: row.videoUrl,
    fkColumn: "sourceVideoId",
    snapshot: {
      kind: "video",
      name: row.productName || `${row.videoType} video`,
      productName: row.productName,
      videoType: row.videoType,
      script: row.script,
      aspectRatio: row.aspectRatio,
    },
  };
}

async function loadReviewGraphic(id: string): Promise<LoadedSource> {
  const [row] = await db
    .select()
    .from(schema.reviewGraphics)
    .where(eq(schema.reviewGraphics.id, id))
    .limit(1);
  if (!row) throw new SourceError("Review graphic not found");
  if (row.status !== "approved") throw new SourceError("Review graphic must be approved before posting");
  if (!row.clientId) throw new SourceError("Review graphic has no client");

  const assets = await db
    .select()
    .from(schema.reviewGraphicAssets)
    .where(eq(schema.reviewGraphicAssets.graphicId, id));

  const byFormat: Record<string, string> = {};
  for (const a of assets) {
    if (a.imageUrl && a.status === "completed") byFormat[a.format] = a.imageUrl;
  }
  // Primary media = ig_feed, else fb, else story.
  const primary = byFormat.ig_feed || byFormat.fb || byFormat.story;
  if (!primary) throw new SourceError("Review graphic has no completed image assets");

  const hashtags = Array.isArray(row.hashtags)
    ? (row.hashtags as unknown[]).map((h) => String(h).replace(/^#+/, "").trim()).filter(Boolean)
    : [];

  return {
    clientId: row.clientId,
    mediaType: "image",
    mediaUrl: primary,
    fkColumn: "sourceReviewGraphicId",
    snapshot: {
      kind: "review_graphic",
      name: `Review — ${row.reviewerName || "customer"}`,
      reviewerName: row.reviewerName,
      stars: row.stars,
      pullQuote: row.pullQuote,
      reviewText: (row.reviewText || "").slice(0, 400),
    },
    reviewCaptions: {
      instagram: row.instagramCaption || "",
      facebook: row.facebookCaption || "",
      story: row.storiesCaption || row.instagramCaption || "",
      hashtags,
    },
    reviewAssets: { ig_feed: byFormat.ig_feed, story: byFormat.story, fb: byFormat.fb },
  };
}
