/**
 * Claude API client for static ad custom pipeline.
 * Supports vision (base64 images with auto-resize) + extended thinking.
 */

import sharp from "sharp";
import { downloadFromR2, r2KeyFromUrl } from "@/lib/r2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// Claude's base64 image limit is 5MB. Base64 adds ~33% overhead,
// so we target 3.5MB raw to stay safely under the limit.
const MAX_RAW_BYTES = 3_500_000;
const MAX_DIMENSION = 1568; // Claude's recommended max for vision
const JPEG_QUALITY = 85;

function getApiKey(): string {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  return key;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

type CallClaudeOptions = {
  system: string;
  messages: Message[];
  maxTokens?: number;
  budgetTokens?: number;
  model?: string;
  /** Override the API key (e.g. a vault-managed key from getApiKey()). Falls back to env. */
  apiKey?: string;
};

type CallClaudeResult = {
  text: string;
  thinkingText?: string;
};

/**
 * Detect actual image format from buffer magic bytes.
 */
function detectMediaType(buffer: Buffer): string {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "image/webp"; // RIFF
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
  return "image/png"; // fallback
}

/**
 * Resize an image buffer if it exceeds the size limit.
 * Also detects actual format to avoid media type mismatches.
 * Returns buffer under MAX_RAW_BYTES with correct media type.
 */
async function ensureImageFitsLimit(
  buffer: Buffer,
  _mediaType: string
): Promise<{ buffer: Buffer; mediaType: string }> {
  // Always detect actual format from bytes (R2 content-type can be wrong)
  const detectedType = detectMediaType(buffer);

  // If already small enough, return with corrected media type
  if (buffer.length <= MAX_RAW_BYTES) {
    return { buffer, mediaType: detectedType };
  }

  // Resize to max dimension and convert to JPEG
  let img = sharp(buffer).resize(MAX_DIMENSION, MAX_DIMENSION, {
    fit: "inside",
    withoutEnlargement: true,
  });

  let output = await img.jpeg({ quality: JPEG_QUALITY }).toBuffer();

  // If still too large, reduce quality progressively
  let quality = JPEG_QUALITY;
  while (output.length > MAX_RAW_BYTES && quality > 30) {
    quality -= 15;
    output = await sharp(buffer)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
  }

  // Last resort: shrink dimensions further
  if (output.length > MAX_RAW_BYTES) {
    output = await sharp(buffer)
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
  }

  return { buffer: output, mediaType: "image/jpeg" };
}

/**
 * Download an image and convert to base64 content block for Claude vision.
 * Auto-resizes images that exceed Claude's 5MB base64 limit.
 * Uses R2 S3 client for R2 URLs (private bucket), plain fetch for external URLs.
 */
export async function imageUrlToBase64Block(
  url: string
): Promise<ContentBlock> {
  const r2Key = r2KeyFromUrl(url);

  let buffer: Buffer;
  let mediaType: string;

  if (r2Key) {
    const result = await downloadFromR2(r2Key);
    buffer = result.buffer;
    mediaType = result.contentType.split(";")[0].trim();
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download image (${res.status}): ${url}`);
    buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/png";
    mediaType = contentType.split(";")[0].trim();
  }

  // Auto-resize if too large for Claude
  const resized = await ensureImageFitsLimit(buffer, mediaType);

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: resized.mediaType,
      data: resized.buffer.toString("base64"),
    },
  };
}

export async function callClaude(options: CallClaudeOptions): Promise<CallClaudeResult> {
  const { system, messages, maxTokens = 16000, budgetTokens = 10000, model, apiKey } = options;
  const key = (apiKey || "").trim() || getApiKey();

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || MODEL,
      max_tokens: maxTokens,
      thinking: { type: "enabled", budget_tokens: budgetTokens },
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const json = await response.json();

  let text = "";
  let thinkingText = "";

  for (const block of json.content || []) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "thinking") {
      thinkingText += block.thinking;
    }
  }

  if (!text) {
    throw new Error("No text content in Anthropic API response");
  }

  return { text, thinkingText: thinkingText || undefined };
}
