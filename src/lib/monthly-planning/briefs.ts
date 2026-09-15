/**
 * Brief generation — turns a plan_item into a reviewable Brief (static or video).
 * Portal-native Claude (easy to batch, unlike the n8n Video Brief round-trip);
 * the video payload mirrors the Video Brief system's shape so it feeds brief→video later.
 */

import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { callClaude } from "@/lib/static-ads/anthropic";
import { getApiKey } from "@/lib/api-keys";
import { loadBrandContext } from "./context";
import { CORE_ANGLES } from "@/lib/posting/captions";

type PlanItem = typeof schema.planItems.$inferSelect;

/** Shared grounding block: each brand speaks in its own identity, never a sister brand's. */
function brandGrounding(brandName: string): string {
  return `Brand grounding: write for ${brandName} only. Every fact, capability, service promise, stat or claim must come from ${brandName}'s own brand context and USPs in the user message. ${brandName} has sister brands — never borrow their names, facts, claims or positioning; if it is not in ${brandName}'s own context, leave it out. The angle is a theme, not a fact: only assert what it implies where ${brandName}'s context supports it.`;
}

function staticSystem(brandName: string): string {
  return `You are a senior creative director for ${brandName} (an Australian promotional products company, B2B). Write a STATIC ad brief for one social post. Output ONLY valid JSON (no markdown). Australian English. Do not invent facts/prices.

${brandGrounding(brandName)}

Shape:
{
  "concept": "the core idea in one line",
  "angle": "which angle and why",
  "visual_direction": "what the image shows — composition, product placement, setting, mood",
  "on_image_copy": "the exact short text to appear ON the image (headline + optional subline)",
  "ad_copy": "the value proposition / supporting copy the design should convey",
  "caption_direction": "guidance for the organic caption (tone, CTA)",
  "product_name": "the product this features (or null)"
}`;
}

function videoSystem(brandName: string): string {
  return `You are a senior video creative director for ${brandName} (B2B promotional products). Write a VIDEO brief a creator can execute. Output ONLY valid JSON (no markdown). Australian English, UGC problem→solution style, SHOW don't tell.

${brandGrounding(brandName)}

Shape:
{
  "narrative": "problem → frustration → discovery → solution, 2-3 sentences",
  "hooks": ["3-5 hook line variations"],
  "script": "the full spoken script / voiceover",
  "shot_list": ["ordered shots with specific visual directions"],
  "format_specs": "duration + orientation (e.g. 15s, 9:16) + on-screen text notes",
  "tone_notes": "delivery + brand voice notes"
}`;
}

function angleLabel(tag: string | null): string {
  return CORE_ANGLES.find((a) => a.tag === tag)?.label || "brand value";
}

function parseJson(text: string): Record<string, unknown> {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned.startsWith("{")) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) cleaned = m[0];
  }
  return JSON.parse(cleaned);
}

/**
 * Generate (or regenerate) the brief for one plan item. Writes plan_briefs,
 * links plan_items.brief_id, flips the item to brief_ready (or error).
 */
export async function generateBrief(item: PlanItem, apiKey?: string): Promise<void> {
  const key = apiKey || (await getApiKey("ANTHROPIC_API_KEY"));
  try {
    const ctx = await loadBrandContext(item.clientId);
    const product = item.productId ? ctx.products.find((p) => p.id === item.productId) : undefined;

    const shared = `Brand: ${ctx.brandName}
Angle: ${angleLabel(item.angleTag)}
Topic: ${item.topic || "(brand post)"}
Format: ${item.format}
Slot direction: ${item.direction || "(none)"}
${product ? `Product: ${product.name}${product.keyBenefits ? ` — ${product.keyBenefits}` : ""}` : ""}

Brand USPs: ${ctx.usps.slice(0, 6).join(" | ") || "(none)"}
Brand context: ${ctx.brandIntel.slice(0, 2500)}`;

    const isStatic = item.assetType === "static";
    const { text } = await callClaude({
      system: isStatic ? staticSystem(ctx.brandName) : videoSystem(ctx.brandName),
      messages: [{ role: "user", content: `${shared}\n\nWrite the ${isStatic ? "static" : "video"} brief JSON now.` }],
      maxTokens: 3000,
      budgetTokens: 1500,
      apiKey: key,
    });

    const payload = parseJson(text);

    // Upsert: one brief per item (delete-then-insert to keep it simple on regenerate).
    await db.delete(schema.planBriefs).where(eq(schema.planBriefs.planItemId, item.id));
    const [brief] = await db
      .insert(schema.planBriefs)
      .values({
        planItemId: item.id,
        clientId: item.clientId,
        briefType: isStatic ? "static" : "video",
        payload,
        status: "ready",
        aiModel: "claude-sonnet-4-6",
      })
      .returning();

    await db
      .update(schema.planItems)
      .set({ briefId: brief.id, status: "brief_ready", errorMessage: null, updatedAt: new Date() })
      .where(eq(schema.planItems.id, item.id));
  } catch (err) {
    await db
      .update(schema.planItems)
      .set({ status: "error", errorMessage: `Brief failed: ${err instanceof Error ? err.message : "unknown"}`, updatedAt: new Date() })
      .where(eq(schema.planItems.id, item.id));
  }
}
