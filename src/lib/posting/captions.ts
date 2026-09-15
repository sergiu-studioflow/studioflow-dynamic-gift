/**
 * Organic caption generation for the posting scheduler.
 *
 * Turns a source creative (static ad / winner / video) into *organic* per-platform
 * social captions — NOT paid-ad copy. Written in the selected brand's own voice and
 * grounded only in that brand's intelligence + USPs + the source context, framed
 * around one of the 5 core angles (rotated per post so the queue naturally covers all five).
 *
 * Uses the vault-managed ANTHROPIC_API_KEY via getApiKey() (falls back to env).
 */

import { callClaude } from "@/lib/static-ads/anthropic";
import { getApiKey } from "@/lib/api-keys";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { PLATFORMS, clampHashtags, type PlatformKey } from "./platforms";

/** The 5 core angles (shared with the Ad Copy system). */
export const CORE_ANGLES = [
  { tag: "speed", label: "Speed & turnaround vs competitors" },
  { tag: "full_service", label: "Full-service concierge vs self-serve" },
  { tag: "price", label: "Price competitiveness and value" },
  { tag: "proof", label: "Proof points (stats, case studies, social proof)" },
  { tag: "objection", label: "Objection handling embedded naturally" },
] as const;

export type PlatformCaptions = Record<PlatformKey, { caption: string; hashtags: string[] }>;

/** Brand-neutral template: each brand writes in its own identity (no parent-company voice). */
function systemPrompt(brandName: string): string {
  return `You are a senior organic social media copywriter for ${brandName}, an Australian promotional products company (a B2B brand). You write ORGANIC social posts — warm, helpful, brand-building — NOT paid ad copy. No hard-sell, no "SHOP NOW", no ad-style urgency stacking.

# Brand grounding
- Write as ${brandName} only. Every fact, capability, service promise, stat or claim must come from ${brandName}'s own brand context and USPs in the user message.
- ${brandName} has sister brands. Never borrow their names, facts, claims or positioning; if something is not in ${brandName}'s own context, leave it out.
- The post's angle is a theme to lead with, not a fact — only assert what it implies (turnaround, pricing, importing, service) where ${brandName}'s context supports it.

# Output rules
- Output ONLY valid JSON. No markdown, no code fences, no prose before or after.
- Use double quotes. Escape internal quotes.
- Australian English spelling and idiom (colour, organise, catalogue).
- Do NOT invent facts, prices, stats, or claims not supported by the provided context.
- Each caption ends with ONE soft CTA (request a quote / get in touch / browse the range).
- Return hashtags SEPARATELY (array, no '#'), never inside the caption text.
- Keep captions within the per-platform length guidance given below.`;
}

function buildUserMessage(input: {
  brandName: string;
  angleLabel: string;
  brandContext: string;
  usps: string[];
  sourceContext: string;
  platforms: PlatformKey[];
}): string {
  const platformSpec = input.platforms
    .map((p) => {
      const def = PLATFORMS[p];
      return `- ${def.key}: ${def.norms}\n  Length target: ~${def.captionIdealMax} chars max. Hashtags: ${def.hashtagMin}-${def.hashtagMax}.`;
    })
    .join("\n");

  const structure = input.platforms
    .map((p) => `    "${p}": { "caption": "string", "hashtags": ["array of strings without #"] }`)
    .join(",\n");

  return `Brand: ${input.brandName}
Primary angle for THIS post (lead with it, don't force the others): ${input.angleLabel}

Brand context (for voice + facts — do not quote verbatim):
${input.brandContext.slice(0, 4000)}

Key differentiators / USPs:
${input.usps.length ? input.usps.map((u) => `- ${u}`).join("\n") : "- (none provided)"}

The creative this post accompanies:
${input.sourceContext.slice(0, 1500)}

Write organic captions for these platforms:
${platformSpec}

Return EXACTLY this JSON shape:
{
${structure}
}`;
}

function parseCaptions(text: string, platforms: PlatformKey[]): PlatformCaptions {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned.startsWith("{")) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) cleaned = m[0];
  }
  const obj = JSON.parse(cleaned) as Record<string, { caption?: unknown; hashtags?: unknown }>;
  const out = {} as PlatformCaptions;
  for (const p of platforms) {
    const entry = obj[p] || {};
    const caption = String(entry.caption || "").trim().slice(0, PLATFORMS[p].captionHardMax);
    const rawTags = Array.isArray(entry.hashtags) ? (entry.hashtags as unknown[]).map(String) : [];
    out[p] = { caption, hashtags: clampHashtags(p, rawTags) };
  }
  return out;
}

/** Fetch brand intel + USPs for grounding. */
async function fetchBrandGrounding(clientId: string): Promise<{ brandName: string; brandContext: string; usps: string[] }> {
  const [brand] = await db
    .select({ name: schema.brands.brandName })
    .from(schema.brands)
    .where(eq(schema.brands.id, clientId))
    .limit(1);

  const intel = await db
    .select({ title: schema.clientBrandIntelligence.title, content: schema.clientBrandIntelligence.content })
    .from(schema.clientBrandIntelligence)
    .where(eq(schema.clientBrandIntelligence.clientId, clientId))
    .orderBy(schema.clientBrandIntelligence.sortOrder);

  const usps = await db
    .select({ text: schema.clientUsps.uspText })
    .from(schema.clientUsps)
    .where(eq(schema.clientUsps.clientId, clientId));

  const brandContext = intel
    .map((s) => `## ${s.title}\n${s.content || ""}`)
    .join("\n\n")
    .slice(0, 6000);

  return {
    brandName: brand?.name || "this brand",
    brandContext: brandContext || "(no brand intelligence on file)",
    usps: usps.map((u) => u.text).filter(Boolean),
  };
}

/** Pick the next core angle by rotation over the brand's post count. */
async function nextAngle(clientId: string): Promise<(typeof CORE_ANGLES)[number]> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.scheduledPosts)
    .where(eq(schema.scheduledPosts.clientId, clientId));
  return CORE_ANGLES[(count ?? 0) % CORE_ANGLES.length];
}

/**
 * Generate organic captions for a source creative. Returns the captions keyed
 * by platform plus the chosen angle tag (persisted on the parent for audit).
 */
export async function generateOrganicCaptions(input: {
  clientId: string;
  sourceContext: string;
  platforms: PlatformKey[];
  /** The angle the creative was built around; the rotation is only used without one. */
  angleTag?: string | null;
}): Promise<{ captions: PlatformCaptions; angleTag: string }> {
  const planned = CORE_ANGLES.find((a) => a.tag === input.angleTag);
  const [{ brandName, brandContext, usps }, angle, apiKey] = await Promise.all([
    fetchBrandGrounding(input.clientId),
    planned ?? nextAngle(input.clientId),
    getApiKey("ANTHROPIC_API_KEY"),
  ]);

  const userMessage = buildUserMessage({
    brandName,
    angleLabel: angle.label,
    brandContext,
    usps,
    sourceContext: input.sourceContext,
    platforms: input.platforms,
  });

  const { text } = await callClaude({
    system: systemPrompt(brandName),
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 2500,
    budgetTokens: 1200,
    apiKey,
  });

  return { captions: parseCaptions(text, input.platforms), angleTag: angle.tag };
}
