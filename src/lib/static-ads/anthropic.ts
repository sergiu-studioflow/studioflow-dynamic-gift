/**
 * Claude API client for static ad custom pipeline.
 * Supports vision (base64 images with auto-resize) + extended thinking.
 */

import sharp from "sharp";
import { downloadFromR2, r2KeyFromUrl, toExternalUrl } from "@/lib/r2";
import { getApiKey as getConfiguredKey } from "@/lib/api-keys";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

/** Extended thinking rejects budgets below this with a 400. */
const MIN_THINKING_BUDGET = 1024;

// Transient-failure retry (429 / 529 / 5xx / overloaded_error). Bounded so a call still
// fits the 300s routes that chain several of them: at most 3 retries, 30s of waiting.
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const RETRY_MAX_DELAY_MS = 15000;
const RETRY_TOTAL_WAIT_MS = 30000;
const RETRYABLE_ERROR_TYPES = new Set(["overloaded_error", "rate_limit_error", "api_error"]);

// Claude's base64 image limit is 5MB. Base64 adds ~33% overhead,
// so we target 3.5MB raw to stay safely under the limit.
const MAX_RAW_BYTES = 3_500_000;
const MAX_DIMENSION = 1568; // Claude's recommended max for vision
const JPEG_QUALITY = 85;

/**
 * The key a call runs with: an explicit override, else the key saved in Settings → API Keys
 * (encrypted vault), else the ANTHROPIC_API_KEY env var — getApiKey() does the last fallback.
 */
async function resolveApiKey(override?: string): Promise<string> {
  const explicit = (override || "").trim();
  if (explicit) return explicit;
  const key = (await getConfiguredKey("ANTHROPIC_API_KEY")).trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured — add it in Settings → API Keys");
  return key;
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, RETRY_MAX_DELAY_MS);
  }
  const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return backoff * (0.8 + Math.random() * 0.4);
}

function isRetryableHttpFailure(status: number, body: string, shouldRetryHeader: string | null): boolean {
  if (shouldRetryHeader === "false") return false;
  if (shouldRetryHeader === "true") return true;
  return status === 429 || status === 529 || status >= 500 || body.includes("overloaded_error");
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

type AnthropicResponseBody = {
  type?: string;
  error?: { type?: string; message?: string };
  content?: Array<{ type: string; text?: string; thinking?: string }>;
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
  const img = sharp(buffer).resize(MAX_DIMENSION, MAX_DIMENSION, {
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

  async function overHttps(target: string) {
    const res = await fetch(target);
    if (!res.ok) throw new Error(`Failed to download image (${res.status}): ${target}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mediaType: (res.headers.get("content-type") || "image/png").split(";")[0].trim(),
    };
  }

  if (r2Key) {
    try {
      const result = await downloadFromR2(r2Key);
      buffer = result.buffer;
      mediaType = result.contentType.split(";")[0].trim();
    } catch (err) {
      // The S3 path needs R2_* credentials and a well-formed endpoint. Every
      // object we address this way is also served on the public r2.dev host, so
      // fall back to plain HTTPS rather than failing the generation. This is not
      // only a local-dev convenience: without it, rotating or misconfiguring the
      // R2 credentials takes the whole static-ad pipeline down at once.
      console.warn("[static-ads] R2 S3 download failed, falling back to public URL:", (err as Error).message);
      const viaHttps = await overHttps(toExternalUrl(url));
      buffer = viaHttps.buffer;
      mediaType = viaHttps.mediaType;
    }
  } else {
    const direct = await overHttps(url);
    buffer = direct.buffer;
    mediaType = direct.mediaType;
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
  const key = await resolveApiKey(apiKey);

  // Keep the request valid: the API 400s on a budget under the minimum, or on
  // max_tokens that doesn't exceed the budget.
  const thinkingBudget = Math.max(budgetTokens, MIN_THINKING_BUDGET);
  const requestMaxTokens = maxTokens > thinkingBudget ? maxTokens : thinkingBudget + MIN_THINKING_BUDGET;
  const body = JSON.stringify({
    model: model || MODEL,
    max_tokens: requestMaxTokens,
    thinking: { type: "enabled", budget_tokens: thinkingBudget },
    system,
    messages,
  });

  let waitedMs = 0;
  let json: AnthropicResponseBody | null = null;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body,
    });

    const canRetry = attempt < MAX_RETRIES && waitedMs < RETRY_TOTAL_WAIT_MS;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (canRetry && isRetryableHttpFailure(response.status, text, response.headers.get("x-should-retry"))) {
        const delay = retryDelayMs(attempt, response.headers.get("retry-after"));
        console.warn(`[anthropic] ${response.status} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay)}ms`);
        waitedMs += delay;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error(`Anthropic API error (${response.status}): ${text}`);
    }

    json = (await response.json()) as AnthropicResponseBody;

    // An error can also arrive inside a 200 body (e.g. relayed by a proxy).
    if (json?.type === "error") {
      const errorType = json.error?.type || "error";
      if (canRetry && RETRYABLE_ERROR_TYPES.has(errorType)) {
        const delay = retryDelayMs(attempt, null);
        console.warn(`[anthropic] ${errorType} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay)}ms`);
        waitedMs += delay;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error(`Anthropic API error (${errorType}): ${json.error?.message || JSON.stringify(json)}`);
    }
    break;
  }

  let text = "";
  let thinkingText = "";

  for (const block of json?.content || []) {
    if (block.type === "text") {
      text += block.text ?? "";
    } else if (block.type === "thinking") {
      thinkingText += block.thinking ?? "";
    }
  }

  if (!text) {
    throw new Error("No text content in Anthropic API response");
  }

  return { text, thinkingText: thinkingText || undefined };
}
