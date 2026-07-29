// Claude caller for the QC gate. Distinct from src/lib/static-ads/anthropic.ts (which
// forces extended thinking on for generation): grading wants NO thinking — cheaper, faster,
// a plain JSON-in-text response we parse. Reuses the same encrypted ANTHROPIC_API_KEY so
// the generation client is left untouched.
//
// Two jobs here:
//   1. isTransient / parseJsonLoose — used by the pipeline and every grader.
//   2. The FALLBACK judge. Gemini is the primary (it is the only one of the two that can
//      grade video), but Dynamic Gift's vault has no Gemini key on day one, so images and
//      text fall back to Claude vision and grade from the start. Video has no fallback —
//      see provider.ts, which flags it for a human rather than auto-approving blind.

import { getApiKey } from "@/lib/api-keys";
import { imageUrlToBase64Block } from "@/lib/static-ads/anthropic";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";

// Claude Sonnet 4.6 pricing (USD per 1M tokens).
const PRICE_IN_PER_M = 3;
const PRICE_OUT_PER_M = 15;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ClaudeMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

export class ClaudeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ClaudeError";
  }
}

// getApiKey hits the encrypted-keys table — cache the resolved key for 60s so a
// 25-grade cron batch doesn't re-SELECT it per call. Only non-empty keys cache.
const KEY_CACHE_TTL_MS = 60_000;
let cachedKey: { value: string; expiresAt: number } | null = null;

async function anthropicKey(): Promise<string> {
  if (cachedKey && Date.now() < cachedKey.expiresAt) return cachedKey.value;
  const key = await getApiKey("ANTHROPIC_API_KEY");
  if (!key) throw new ClaudeError("ANTHROPIC_API_KEY is not configured", 0);
  cachedKey = { value: key, expiresAt: Date.now() + KEY_CACHE_TTL_MS };
  return key;
}

export async function claudeConfigured(): Promise<boolean> {
  try {
    return !!(await getApiKey("ANTHROPIC_API_KEY"));
  } catch {
    return false;
  }
}

export async function callClaudeJSON(opts: {
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
}): Promise<{ text: string; costCents: number }> {
  const apiKey = await anthropicKey();

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      temperature: 0.2,
      system: opts.system,
      messages: opts.messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ClaudeError(`Anthropic API error (${res.status}): ${body}`.slice(0, 300), res.status);
  }

  const json = await res.json();
  let text = "";
  for (const block of json.content || []) {
    if (block.type === "text") text += block.text;
  }
  const u = json.usage || {};
  const costUsd = ((u.input_tokens || 0) * PRICE_IN_PER_M + (u.output_tokens || 0) * PRICE_OUT_PER_M) / 1_000_000;
  return { text, costCents: Math.round(costUsd * 100) };
}

/**
 * Fallback image grader. Reference images are attached BEFORE the graded asset so the
 * rubric's "the LAST attachment is the creative you are grading" instruction holds — the
 * same ordering Gemini gets. A reference that fails to load is skipped with a warning
 * rather than blocking the grade (the rubric degrades to integrity-only judging).
 *
 * imageUrlToBase64Block already handles private-R2 downloads and sharp-resizes to Claude's
 * 5MB / 1568px limits, so we reuse it rather than re-implementing the transport.
 */
export async function gradeImageWithClaude(opts: {
  system: string;
  prompt: string;
  imageUrl: string;
  referenceImages?: string[];
  maxTokens?: number;
}): Promise<{ text: string; costCents: number }> {
  const content: ContentBlock[] = [];

  for (const ref of (opts.referenceImages ?? []).slice(0, 4)) {
    try {
      content.push((await imageUrlToBase64Block(ref)) as ContentBlock);
    } catch (e) {
      console.warn("[qc/claude] reference image skipped", ref, String(e).slice(0, 120));
    }
  }
  content.push((await imageUrlToBase64Block(opts.imageUrl)) as ContentBlock);
  content.push({ type: "text", text: opts.prompt });

  return callClaudeJSON({
    system: opts.system,
    messages: [{ role: "user", content }],
    maxTokens: opts.maxTokens ?? 2000,
  });
}

/** Text-lane grader — no attachments, just the rubric and the copy under review. */
export async function gradeTextWithClaude(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ text: string; costCents: number }> {
  return callClaudeJSON({
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    maxTokens: opts.maxTokens ?? 2000,
  });
}

/** Retryable (network / 429 / 5xx) vs permanent error — drives the pipeline retry loop. */
export function isTransient(e: unknown): boolean {
  const status = (e as { status?: number })?.status ?? 0;
  if (status === 429 || status >= 500) return true;
  return /connection error|fetch failed|econnreset|etimedout|socket|network|timed out|overloaded/i.test(
    String((e as { message?: string })?.message ?? e)
  );
}

/** Tolerant JSON extractor — strips ```json fences and slices the outer {...}. */
export function parseJsonLoose<T>(text: string): T {
  let t = (text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t) as T;
  } catch {
    return {} as T;
  }
}
