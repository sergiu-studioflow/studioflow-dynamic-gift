/**
 * Static-Ad Prompt Builder — Claude client (official @anthropic-ai/sdk).
 *
 * The runtime ad-generation path uses the raw-fetch wrapper in `../anthropic.ts`
 * (Sonnet 4.6, extended thinking). This build-time pipeline instead uses the
 * official SDK so it can use Claude Opus 5 with adaptive thinking, the
 * `effort` control, server-side web_search/web_fetch tools, streaming, and
 * structured outputs — none of which the legacy raw-fetch wrapper supports.
 *
 * Request shapes follow the claude-api skill for Opus 5:
 *   - thinking: { type: "adaptive" }   (budget_tokens / temperature 400 on 4.8)
 *   - output_config: { effort }        ("low"|"medium"|"high"|"xhigh"|"max")
 *   - web tools: web_search_20260209 / web_fetch_20260209 (GA, dynamic filtering)
 *   - pause_turn: resume by re-sending [...messages, assistant(content)]
 *   - stream long / tool-using calls to avoid HTTP timeouts
 *
 * Tool version strings and the adaptive-thinking / output_config fields may be
 * newer than the installed SDK's static types, so request bodies are cast at
 * the call site (the repo already casts `tools` as `never` for the same reason).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getApiKey } from "@/lib/api-keys";
import { imageUrlToBase64Block } from "../anthropic";

export const PROMPT_BUILDER_MODEL = "claude-opus-5";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Server-side web tools (GA, dynamic filtering built in — no beta header). */
export const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
] as const;

export { imageUrlToBase64Block };

let cachedClient: Anthropic | null = null;
let cachedKey: string | null = null;

async function getClient(): Promise<Anthropic> {
  const apiKey = await getApiKey("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  // A run is ~10 calls over several minutes; a single transient 429/529 must not
  // sink it, and there is no stage-level retry above this. The SDK retries those
  // (and connection errors) with exponential backoff.
  cachedClient = new Anthropic({ apiKey, maxRetries: 4 });
  cachedKey = apiKey;
  return cachedClient;
}

/**
 * Transient-failure retry around a streamed call.
 *
 * The SDK's own `maxRetries` only covers failures that arrive as an HTTP status.
 * An `overloaded_error` on a streaming request arrives as an SSE error event
 * MID-STREAM, which the SDK surfaces from finalMessage() without retrying — so a
 * six-minute pipeline dies on a momentary capacity blip. Everything here is
 * idempotent (no writes), so retrying is safe.
 */
const TRANSIENT =
  /overloaded|rate.?limit|\b429\b|\b5\d\d\b|internal server|timeout|ECONNRESET|ETIMEDOUT|fetch failed|terminated/i;

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number })?.status;
      const retryable = TRANSIENT.test(msg) || status === 429 || (typeof status === "number" && status >= 500);
      if (!retryable || i === attempts - 1) throw err;
      // 3s, 9s, 27s (+jitter) — capacity blips clear on the order of seconds.
      const waitMs = 3000 * Math.pow(3, i) + Math.floor(Math.random() * 1000);
      console.warn(`[prompt-builder] ${label} transient failure, retrying in ${Math.round(waitMs / 1000)}s: ${msg.slice(0, 140)}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

type CallOpusOptions = {
  system: string;
  messages: Anthropic.MessageParam[];
  effort?: Effort;
  maxTokens?: number;
  /** Pass WEB_TOOLS to enable server-side web_search + web_fetch. */
  tools?: ReadonlyArray<{ type: string; name: string }>;
  /** Max pause_turn resumes before giving up (server-tool loop continuation). */
  maxContinuations?: number;
};

/**
 * One Opus 5 call returning the concatenated assistant text. Streams to avoid
 * HTTP timeouts, and resumes automatically on stop_reason "pause_turn" (which
 * occurs when the server-side web-tool loop hits its iteration cap mid-turn).
 */
export async function callOpus(opts: CallOpusOptions): Promise<{ text: string }> {
  const client = await getClient();
  const { system, effort = "high", maxTokens = 16000, tools, maxContinuations = 6 } = opts;

  let messages: Anthropic.MessageParam[] = [...opts.messages];
  let text = "";

  for (let i = 0; i <= maxContinuations; i++) {
    const body = {
      model: PROMPT_BUILDER_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort },
      system,
      messages,
      ...(tools && tools.length ? { tools } : {}),
    };

    const msg = await withRetry("callOpus", () =>
      client.messages.stream(body as unknown as Anthropic.MessageStreamParams).finalMessage()
    );

    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
    }

    if (msg.stop_reason === "pause_turn" && i < maxContinuations) {
      // Resume the server-tool loop: append the assistant turn and re-send.
      messages = [
        ...messages,
        { role: "assistant", content: msg.content as unknown as Anthropic.ContentBlockParam[] },
      ];
      continue;
    }
    break;
  }

  if (!text.trim()) throw new Error("Opus returned no text content");
  return { text: text.trim() };
}

/**
 * Opus 5 call constrained to a JSON schema via output_config.format.
 * Returns the parsed object. Used for machine-readable extraction stages
 * (hex palette, critic verdict). No web tools — keep structured calls tool-free.
 */
export async function callOpusJSON<T>(opts: {
  system: string;
  messages: Anthropic.MessageParam[];
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}): Promise<T> {
  const client = await getClient();
  const body = {
    model: PROMPT_BUILDER_MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: opts.schema } },
    system: opts.system,
    messages: opts.messages,
  };

  const msg = await withRetry("callOpusJSON", () =>
    client.messages.stream(body as unknown as Anthropic.MessageStreamParams).finalMessage()
  );

  let text = "";
  for (const block of msg.content) {
    if (block.type === "text") text += block.text;
  }
  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Opus structured call did not return valid JSON: " + text.slice(0, 300));
  }
}

/** Build a Claude vision image block from a URL (R2 or external). */
export async function imageBlock(url: string): Promise<Anthropic.ImageBlockParam> {
  return (await imageUrlToBase64Block(url)) as unknown as Anthropic.ImageBlockParam;
}
