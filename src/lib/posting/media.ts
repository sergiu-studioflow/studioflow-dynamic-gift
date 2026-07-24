/**
 * Media probing, placement routing, and re-encoding for the posting scheduler.
 *
 * - Probe R2 media at queue time (doubles as a public-reachability check).
 * - Route each platform to the right placement based on aspect ratio:
 *     Instagram feed accepts 4:5 (0.8) … 1.91:1. Anything taller than 4:5
 *     (e.g. 9:16 story crops from the static-ad pipeline) → IG Story.
 *     Facebook feed accepts any ratio.
 * - Re-encode to JPEG when the image is too large or a marginal ratio can be
 *   safely centre-cropped to fit IG feed; upload the variant to R2 and return
 *   its public URL as a per-target media_override_url.
 */

import sharp from "sharp";
import { downloadFromR2, r2KeyFromUrl, uploadToR2, toExternalUrl } from "@/lib/r2";
import type { PlatformKey, Placement } from "./platforms";

const IG_FEED_MIN_RATIO = 0.8; // 4:5 portrait
const IG_FEED_MAX_RATIO = 1.91; // 1.91:1 landscape
const IG_MAX_BYTES = 8_000_000;
const CROP_TOLERANCE = 0.05; // within 5% of the 4:5 bound → crop to fit rather than route to story

export type ProbedMedia = {
  width: number | null;
  height: number | null;
  bytes: number;
  contentType: string;
  isImage: boolean;
};

async function fetchMedia(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const key = r2KeyFromUrl(url);
  if (key) {
    const r = await downloadFromR2(key);
    return { buffer: r.buffer, contentType: r.contentType };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`media fetch failed (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get("content-type") || "application/octet-stream" };
}

/** Probe media dimensions + size. Throws if the media is unreachable. */
export async function probeMedia(url: string, mediaType: "image" | "video"): Promise<ProbedMedia> {
  const { buffer, contentType } = await fetchMedia(url);
  if (mediaType === "video") {
    return { width: null, height: null, bytes: buffer.length, contentType, isImage: false };
  }
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width ?? null,
    height: meta.height ?? null,
    bytes: buffer.length,
    contentType,
    isImage: true,
  };
}

/**
 * Decide the placement for one platform given the source aspect ratio.
 * Returns the placement plus whether a re-encode is needed for IG feed.
 */
export function routePlacement(
  platform: PlatformKey,
  mediaType: "image" | "video",
  width: number | null,
  height: number | null
): { placement: Placement; needsIgCrop: boolean } {
  if (mediaType === "video") {
    return { placement: platform === "instagram" ? "reel" : "feed", needsIgCrop: false };
  }
  if (platform === "facebook") {
    return { placement: "feed", needsIgCrop: false }; // FB feed accepts any ratio
  }
  // Instagram image
  if (!width || !height) return { placement: "feed", needsIgCrop: false };
  const r = width / height;
  if (r >= IG_FEED_MIN_RATIO && r <= IG_FEED_MAX_RATIO) {
    return { placement: "feed", needsIgCrop: false };
  }
  // Taller than 4:5 but within crop tolerance → crop to 4:5 feed.
  if (r < IG_FEED_MIN_RATIO && r >= IG_FEED_MIN_RATIO - CROP_TOLERANCE) {
    return { placement: "feed", needsIgCrop: true };
  }
  // Much taller (9:16 story crops) → route to Story.
  if (r < IG_FEED_MIN_RATIO) {
    return { placement: "story", needsIgCrop: false };
  }
  // Wider than 1.91:1 → crop to 1.91 landscape feed.
  return { placement: "feed", needsIgCrop: true };
}

/**
 * Produce an IG-compliant JPEG variant of an image and upload it to R2.
 * Centre-crops to the nearest IG-feed bound when needed, always outputs JPEG
 * (sRGB, ≤ IG size cap). Returns the public (external) R2 URL for the variant.
 */
export async function makeIgVariant(opts: {
  sourceUrl: string;
  storageBase: string; // e.g. "brands/dynamic-gift"
  postId: string;
  crop: boolean;
}): Promise<string> {
  const { buffer } = await fetchMedia(opts.sourceUrl);
  let img = sharp(buffer).rotate(); // honour EXIF orientation
  const meta = await img.metadata();

  if (opts.crop && meta.width && meta.height) {
    const r = meta.width / meta.height;
    let targetW = meta.width;
    let targetH = meta.height;
    if (r < IG_FEED_MIN_RATIO) {
      // too tall → crop height to 4:5
      targetH = Math.round(meta.width / IG_FEED_MIN_RATIO);
    } else if (r > IG_FEED_MAX_RATIO) {
      // too wide → crop width to 1.91:1
      targetW = Math.round(meta.height * IG_FEED_MAX_RATIO);
    }
    img = img.resize(targetW, targetH, { fit: "cover", position: "attention" });
  }

  let quality = 88;
  let out = await img.jpeg({ quality, mozjpeg: true }).toBuffer();
  while (out.length > IG_MAX_BYTES && quality > 50) {
    quality -= 12;
    out = await sharp(buffer).rotate().jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  const key = `${opts.storageBase}/posting/${opts.postId}-instagram.jpg`;
  const url = await uploadToR2(key, out, "image/jpeg");
  // Publish must use the external public R2 host (the primary R2_PUBLIC_URL host
  // can 401 for Meta's crawler); toExternalUrl rewrites to pub-…r2.dev.
  return toExternalUrl(url);
}
