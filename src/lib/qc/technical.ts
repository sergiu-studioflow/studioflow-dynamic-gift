// Deterministic technical checks — graded in CODE, never by the vision judge
// (resolution and file integrity are facts, not judgement calls).
//
// Statics: sharp metadata probe — byte floor, actual-vs-declared aspect (>5% deviation
// fails), short-side floor at 90% of the row's own resolution nominal. IMPORTANT: the
// floor uses the Kie RENDER nominal (1K≈1024 / 2K≈1536 / 4K≈2048 short side — Kie 2K 9:16
// comes back ≈1536×2752), never a 1080-based download-target map: flooring against one of
// those would wrongly fail every 1K render.
//
// Videos: file present, video/* content type, byte floor. (Duration/bitrate probing would
// need ffprobe — not available on Vercel; Gemini sees the clip anyway.)

import sharp from "sharp";

export type TechnicalResult = { pass: boolean; note: string };

// Short-side nominals for Kie render resolutions.
const RESOLUTION_SHORT_SIDE: Record<string, number> = { "1K": 1024, "2K": 1536, "4K": 2048 };
const SHORT_SIDE_TOLERANCE = 0.9; // fail below 90% of nominal
const ASPECT_TOLERANCE = 0.05; // 5% deviation
const MIN_IMAGE_BYTES = 30_000;
const MIN_VIDEO_BYTES = 100_000;

function parseAspect(ar: string | null | undefined): number | null {
  if (!ar || ar === "auto") return null;
  const m = ar.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h) return null;
  return w / h;
}

export async function checkImageTechnical(
  buffer: Buffer,
  row: { aspectRatio?: string | null; resolution?: string | null }
): Promise<TechnicalResult> {
  if (buffer.length < MIN_IMAGE_BYTES) {
    return { pass: false, note: `File suspiciously small (${Math.round(buffer.length / 1024)}KB) — likely corrupt or blank.` };
  }

  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(buffer).rotate().metadata();
    width = meta.width;
    height = meta.height;
  } catch {
    return { pass: false, note: "File could not be decoded as an image." };
  }
  if (!width || !height) {
    return { pass: false, note: "Image has no readable dimensions." };
  }

  const issues: string[] = [];

  const declared = parseAspect(row.aspectRatio);
  if (declared) {
    const actual = width / height;
    const deviation = Math.abs(actual - declared) / declared;
    if (deviation > ASPECT_TOLERANCE) {
      issues.push(
        `Aspect ratio is ${width}×${height} (${actual.toFixed(2)}), expected ${row.aspectRatio} (${declared.toFixed(2)}).`
      );
    }
  }

  const nominal = RESOLUTION_SHORT_SIDE[(row.resolution || "").trim().toUpperCase()] ?? null;
  if (nominal) {
    const shortSide = Math.min(width, height);
    if (shortSide < nominal * SHORT_SIDE_TOLERANCE) {
      issues.push(`Short side is ${shortSide}px — below the ${row.resolution} floor (~${nominal}px).`);
    }
  }

  if (issues.length > 0) return { pass: false, note: issues.join(" ") };
  return { pass: true, note: `${width}×${height}, ${Math.round(buffer.length / 1024)}KB — OK.` };
}

export function checkVideoTechnical(buffer: Buffer, contentType: string): TechnicalResult {
  if (buffer.length < MIN_VIDEO_BYTES) {
    return { pass: false, note: `Video file suspiciously small (${Math.round(buffer.length / 1024)}KB) — likely corrupt or truncated.` };
  }
  if (!contentType.startsWith("video/")) {
    return { pass: false, note: `Unexpected content type "${contentType}" for a video asset.` };
  }
  return { pass: true, note: `${(buffer.length / 1_000_000).toFixed(1)}MB ${contentType} — OK.` };
}
