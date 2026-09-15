/**
 * Media probing, placement routing, and re-encoding for the posting scheduler.
 *
 * - Probe R2 media at queue time (doubles as a public-reachability check).
 * - Route each platform to the right placement based on aspect ratio:
 *     Instagram feed accepts 4:5 (0.8) … 1.91:1. Anything taller than 4:5
 *     (e.g. 9:16 story crops from the static-ad pipeline) → IG Story.
 *     Facebook feed accepts any ratio.
 * - Re-encode every Instagram image to an sRGB JPEG ≤ 8 MB (IG content publishing
 *   accepts JPEG only; static ads and review graphics are PNG), centre-cropping a
 *   marginal ratio to fit IG feed; upload the variant to R2 and return its public
 *   URL as a per-target media_override_url.
 */

import sharp from "sharp";
import { downloadFromR2, r2KeyFromUrl, uploadToR2, toExternalUrl } from "@/lib/r2";
import type { PlatformKey, Placement } from "./platforms";

const IG_FEED_MIN_RATIO = 0.8; // 4:5 portrait
const IG_FEED_MAX_RATIO = 1.91; // 1.91:1 landscape
const IG_MAX_BYTES = 8_000_000;
const IG_MAX_WIDTH = 1440; // IG scales anything wider down to this
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
 * Centre-crops to the nearest IG-feed bound when asked, always outputs JPEG
 * (sRGB, ≤ 1440px wide, ≤ IG size cap). Returns the public (external) R2 URL for the variant.
 */
export async function makeIgVariant(opts: {
  sourceUrl: string;
  storageBase: string; // e.g. "brands/dynamic-gift"
  postId: string;
  crop: boolean;
}): Promise<string> {
  const { buffer } = await fetchMedia(opts.sourceUrl);
  const meta = await sharp(buffer).metadata();
  // metadata() reports stored dimensions; EXIF orientations 5–8 display rotated 90°.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;

  let targetW = width;
  let targetH = height;
  if (opts.crop && width && height) {
    const r = width / height;
    if (r < IG_FEED_MIN_RATIO) {
      // too tall → crop height to 4:5
      targetH = Math.round(width / IG_FEED_MIN_RATIO);
    } else if (r > IG_FEED_MAX_RATIO) {
      // too wide → crop width to 1.91:1
      targetW = Math.round(height * IG_FEED_MAX_RATIO);
    }
  }

  // sharp keeps only the last resize() of a pipeline, so the crop and the width cap are one resize.
  const encode = (quality: number, maxWidth: number) => {
    let img = sharp(buffer).rotate(); // honour EXIF orientation
    if (targetW && targetH) {
      const scale = Math.min(1, maxWidth / targetW);
      img = img.resize(Math.round(targetW * scale), Math.round(targetH * scale), { fit: "cover", position: "attention" });
    }
    return img
      .flatten({ background: "#ffffff" }) // PNG transparency would otherwise turn black
      .toColourspace("srgb")
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  };

  let out = await encode(88, IG_MAX_WIDTH);
  for (const quality of [76, 64, 52]) {
    if (out.length <= IG_MAX_BYTES) break;
    out = await encode(quality, IG_MAX_WIDTH);
  }
  if (out.length > IG_MAX_BYTES) out = await encode(70, 1080);
  if (out.length > IG_MAX_BYTES) throw new Error("Could not re-encode the image under Instagram's 8 MB limit");

  const key = `${opts.storageBase}/posting/${opts.postId}-instagram.jpg`;
  const url = await uploadToR2(key, out, "image/jpeg");
  // Publish must use the external public R2 host (the primary R2_PUBLIC_URL host
  // can 401 for Meta's crawler); toExternalUrl rewrites to pub-…r2.dev.
  return toExternalUrl(url);
}
