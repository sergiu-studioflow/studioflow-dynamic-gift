// Gemini Vision client for the QC gate — the VISUAL grader. Gemini reads images and short
// VIDEOS natively (whole-clip artifact scan + audio track for lip-sync, no poster-frame
// hack). Statics + small videos are sent inline as base64; larger videos go through the
// Files API (upload → poll ACTIVE → reference → delete).
//
// Optional referenceImages — the client's REAL product photos attached BEFORE the graded
// asset so product fidelity is judged against ground truth, not memory.
//
// Key from getApiKey('GEMINI_API_KEY') → env fallback. If the key is missing/invalid the
// caller treats vision as unavailable and flags the asset for a human (never auto-approves).

import { getApiKey } from "@/lib/api-keys";
import { downloadFromR2, r2KeyFromUrl } from "@/lib/r2";
import { imageUrlToBase64Block } from "@/lib/static-ads/anthropic";
import { GEMINI_MODEL } from "./constants";

const BASE = "https://generativelanguage.googleapis.com";

// gemini flash pricing (USD per 1M tokens), rough — for cost_cents display only.
const PRICE_IN_PER_M = 0.3;
const PRICE_OUT_PER_M = 2.5;

// Inline-vs-FilesAPI threshold. The whole generateContent request must stay under ~20MB,
// so inline only comfortably-small videos; anything larger uploads via the Files API.
const INLINE_VIDEO_MAX_BYTES = 18_000_000;

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "GeminiError";
  }
}

// getApiKey hits the encrypted-keys table — cache the resolved key for 60s so a
// grading batch doesn't re-SELECT it per call. Only non-empty keys cache.
const KEY_CACHE_TTL_MS = 60_000;
let cachedKey: { value: string; expiresAt: number } | null = null;

async function geminiKey(): Promise<string> {
  if (cachedKey && Date.now() < cachedKey.expiresAt) return cachedKey.value;
  const key = (await getApiKey("GEMINI_API_KEY")).trim();
  if (!key) throw new GeminiError("GEMINI_API_KEY is not configured", 0);
  cachedKey = { value: key, expiresAt: Date.now() + KEY_CACHE_TTL_MS };
  return key;
}

async function fetchOverHttp(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new GeminiError(`Failed to download asset (${res.status})`, res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  return { buffer, contentType };
}

/**
 * Download any asset: R2 via the S3 client (works for the private bucket), falling back to
 * a plain HTTPS GET.
 *
 * The fallback matters in production, not just locally. If the R2 credentials are ever
 * missing or rotated, every S3 download fails — and because an un-inspectable asset is
 * flagged rather than approved, that would silently flag EVERY new creative across all
 * clients at once. Assets are stored on the public pub-*.r2.dev host, so a plain GET
 * still reaches them. We log loudly so the real problem is still visible.
 */
export async function fetchAsset(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const key = r2KeyFromUrl(url);
  if (key) {
    try {
      const { buffer, contentType } = await downloadFromR2(key);
      return { buffer, contentType: contentType.split(";")[0].trim() };
    } catch (e) {
      console.warn(`[qc] R2 S3 download failed (${String(e).slice(0, 120)}) — retrying over HTTPS`);
      return fetchOverHttp(url);
    }
  }
  return fetchOverHttp(url);
}

type Part =
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } }
  | { text: string };

/** Upload a video to the Gemini Files API and return its ACTIVE file_uri + name. */
async function uploadVideoToFiles(key: string, buffer: Buffer, mime: string): Promise<{ uri: string; name: string }> {
  const numBytes = buffer.length;
  const start = await fetch(`${BASE}/upload/v1beta/files?key=${key}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(numBytes),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "qc-video" } }),
  });
  if (!start.ok) {
    throw new GeminiError(`Gemini Files start failed (${start.status}): ${(await start.text().catch(() => "")).slice(0, 200)}`, start.status);
  }
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new GeminiError("Gemini Files start returned no upload URL", 0);

  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(numBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(buffer),
  });
  if (!up.ok) {
    throw new GeminiError(`Gemini Files upload failed (${up.status})`, up.status);
  }
  const upJson = await up.json();
  let file = upJson.file as { name: string; uri: string; state: string } | undefined;
  if (!file?.name || !file?.uri) throw new GeminiError("Gemini Files upload returned no file", 0);

  // Poll until the video finishes processing (ACTIVE). Bounded.
  for (let i = 0; i < 15 && file.state !== "ACTIVE"; i++) {
    if (file.state === "FAILED") throw new GeminiError("Gemini Files processing FAILED", 0);
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${BASE}/v1beta/${file.name}?key=${key}`);
    if (poll.ok) file = (await poll.json()) as { name: string; uri: string; state: string };
  }
  if (file.state !== "ACTIVE") throw new GeminiError("Gemini Files never became ACTIVE", 0);
  return { uri: file.uri, name: file.name };
}

async function deleteFile(key: string, name: string): Promise<void> {
  try {
    await fetch(`${BASE}/v1beta/${name}?key=${key}`, { method: "DELETE" });
  } catch {
    /* best-effort cleanup */
  }
}

// thinkingBudget:0 was REQUIRED on 2.5-era flash models (thinking eats the output budget →
// truncated JSON scorecard → everything wrongly flagged). Gemini-3-era models REJECT
// thinkingConfig with a GENERIC 400 ("Request contains an invalid argument" — no mention
// of thinking; verified live 2026-07-22 on gemini-flash-latest), so on ANY 400 we retry
// once without it and remember the outcome for the process lifetime (no wasted round-trip
// on subsequent grades). maxOutputTokens stays generous because Gemini 3 thinks dynamically.
let thinkingRejected = false;

async function generate(key: string, system: string, parts: Part[], maxTokens: number): Promise<{ text: string; costCents: number }> {
  const body = (withThinking: boolean) =>
    JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: maxTokens,
        ...(withThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });

  let res = await fetch(`${BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body(!thinkingRejected),
  });
  if (res.status === 400 && !thinkingRejected) {
    res = await fetch(`${BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body(false),
    });
    if (res.ok) thinkingRejected = true;
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new GeminiError(`Gemini API error (${res.status}): ${errText}`.slice(0, 300), res.status);
  }
  const json = await res.json();
  let text = "";
  for (const part of json.candidates?.[0]?.content?.parts || []) {
    if (typeof part.text === "string") text += part.text;
  }
  const u = json.usageMetadata || {};
  const costUsd = ((u.promptTokenCount || 0) * PRICE_IN_PER_M + (u.candidatesTokenCount || 0) * PRICE_OUT_PER_M) / 1_000_000;
  return { text, costCents: Math.round(costUsd * 100) };
}

/**
 * URL → inline image part. Prefers the resize-safe static-ads downloader (it shrinks
 * oversized renders, which keeps token cost down); falls back to fetchAsset's HTTPS path
 * for the same reason fetchAsset has one — a credentials problem must not flag everything.
 */
async function imagePart(url: string): Promise<Part> {
  try {
    const block = await imageUrlToBase64Block(url);
    if (block.type !== "image") throw new GeminiError("Expected an image block", 0);
    return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
  } catch (e) {
    console.warn(`[qc] image downloader failed (${String(e).slice(0, 120)}) — retrying over HTTPS`);
    const { buffer, contentType } = await fetchAsset(url);
    const mime = contentType.startsWith("image/") ? contentType : "image/png";
    return { inline_data: { mime_type: mime, data: buffer.toString("base64") } };
  }
}

/**
 * Grade a visual asset (image or video) against the vision system prompt.
 * `referenceImages` (product ground-truth photos) are attached BEFORE the graded asset,
 * in order — the system prompt tells the judge which is which.
 * Returns Gemini's raw JSON-in-text + the run cost. Throws GeminiError on failure
 * (the caller decides whether that's transient/retry or flag-for-human).
 */
export async function gradeVisual(opts: {
  system: string;
  prompt: string;
  asset: { kind: "image" | "video"; url: string };
  referenceImages?: string[];
  /** Pre-downloaded asset bytes (video technical check already fetched them). */
  prefetched?: { buffer: Buffer; contentType: string };
  maxTokens?: number;
}): Promise<{ text: string; costCents: number }> {
  const key = await geminiKey();
  // Generous budget: Gemini 3 spends dynamic thinking tokens from the same pool; a
  // truncated JSON scorecard would wrongly flag everything. Flash output ≈ $2.5/M →
  // worst case ~1 cent per grade.
  const maxTokens = opts.maxTokens ?? 4096;

  const refParts: Part[] = [];
  for (const url of opts.referenceImages ?? []) {
    try {
      refParts.push(await imagePart(url));
    } catch (e) {
      // A missing reference photo must never block grading — the rubric degrades
      // to no-ground-truth mode (judge integrity only, not colourway-vs-catalogue).
      console.warn("[qc] reference image failed to load, grading without it:", String(e).slice(0, 150));
    }
  }

  if (opts.asset.kind === "image") {
    const parts: Part[] = [...refParts, await imagePart(opts.asset.url), { text: opts.prompt }];
    return generate(key, opts.system, parts, maxTokens);
  }

  // video
  const { buffer, contentType } = opts.prefetched ?? (await fetchAsset(opts.asset.url));
  const mime = contentType.startsWith("video/") ? contentType : "video/mp4";
  let parts: Part[];
  let cleanupName: string | null = null;
  if (buffer.length <= INLINE_VIDEO_MAX_BYTES) {
    parts = [...refParts, { inline_data: { mime_type: mime, data: buffer.toString("base64") } }, { text: opts.prompt }];
  } else {
    const f = await uploadVideoToFiles(key, buffer, mime);
    cleanupName = f.name;
    parts = [...refParts, { file_data: { mime_type: mime, file_uri: f.uri } }, { text: opts.prompt }];
  }
  try {
    return await generate(key, opts.system, parts, maxTokens);
  } finally {
    if (cleanupName) await deleteFile(key, cleanupName);
  }
}

/**
 * Text-lane grade — the same generateContent path with no media parts.
 *
 * maxTokens matches the visual path on purpose. Gemini 3 spends dynamic thinking tokens
 * from the SAME output pool as the response, so a tight budget silently truncates the JSON
 * scorecard — which parses to nothing and flags the piece as "grading unavailable". A long
 * ad-copy concept was enough to cross that line at 2048.
 */
export async function gradeText(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{ text: string; costCents: number }> {
  const key = await geminiKey();
  return generate(key, opts.system, [{ text: opts.prompt }], opts.maxTokens ?? 4096);
}

/** True if a GEMINI_API_KEY is configured (DB or env). Used to message the dashboard. */
export async function geminiConfigured(): Promise<boolean> {
  return !!(await getApiKey("GEMINI_API_KEY")).trim();
}
