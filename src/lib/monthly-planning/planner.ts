/**
 * Month planner — expands the guided-form input into a distributed month of
 * plan_items, grounded per brand. Dates are computed in code (reliable, honours
 * each brand's posting weekdays); Claude fills the creative content per slot.
 */

import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { callClaude } from "@/lib/static-ads/anthropic";
import { getApiKey } from "@/lib/api-keys";
import { CORE_ANGLES } from "@/lib/posting/captions";
import { loadBrandContext, canProduceStatic, type BrandContext } from "./context";

export type PlanInputConfig = {
  brands: string[]; // clientIds
  month: string; // "YYYY-MM"
  postsPerBrand: number;
  platforms: string[]; // ["facebook","instagram"]
  staticRatio: number; // 0..1 fraction of slots that should be static (rest video)
  themes?: string;
  campaigns?: string;
  notes?: string;
};

type SlotSpec = {
  assetType: "static" | "video";
  format: "feed" | "story" | "reel";
  angleTag: string;
  topic: string;
  title: string;
  direction: string;
  productName: string | null;
};

/** Evenly spread `count` dates across the month's allowed weekdays (repeats if count exceeds days). */
export function spreadDates(year: number, monthIdx0: number, count: number, allowedWeekdays: number[]): string[] {
  const days: string[] = [];
  const d = new Date(Date.UTC(year, monthIdx0, 1));
  while (d.getUTCMonth() === monthIdx0) {
    if (allowedWeekdays.includes(d.getUTCDay())) {
      days.push(`${year}-${String(monthIdx0 + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  if (days.length === 0 || count <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.min(days.length - 1, Math.round((i * (days.length - 1)) / Math.max(1, count - 1)));
    out.push(days[idx]);
  }
  return out;
}

const SYSTEM_PROMPT = `You are a senior social content strategist for Dynamic Gift, Australia's largest promotional products company (B2B). You plan a month of ORGANIC social content per brand.

Output ONLY a valid JSON array (no markdown, no prose). Australian English. Do NOT invent products — for static slots you MUST pick a productName from the provided list (exact match) or set it null; for video slots productName may be null.

Each array element:
{
  "assetType": "static" | "video",
  "format": "feed" | "story" | "reel",
  "angleTag": one of the provided angle tags,
  "topic": short topic/theme for this post,
  "title": a short internal label,
  "direction": 1-2 sentences of creative direction (what the post shows/says),
  "productName": exact product name from the list, or null
}`;

function buildUserMessage(ctx: BrandContext, count: number, cfg: PlanInputConfig, canStatic: boolean): string {
  const productList = ctx.staticEligibleProducts.map((p) => `- ${p.name}${p.isHero ? " (hero)" : ""}`).join("\n") || "(no products with images)";
  const angles = CORE_ANGLES.map((a) => `${a.tag} = ${a.label}`).join("; ");
  const staticShare = canStatic ? Math.round(cfg.staticRatio * 100) : 0;
  return `Brand: ${ctx.brandName}
Plan ${count} posts for this month.
Static/video mix: aim for ~${staticShare}% static, the rest video briefs.${canStatic ? "" : " NOTE: this brand cannot produce static ads right now (no product image / reference) — make ALL slots video."}

Angles to rotate through: ${angles}
Platforms: ${cfg.platforms.join(", ")}
${cfg.themes ? `Monthly themes: ${cfg.themes}` : ""}
${cfg.campaigns ? `Campaigns/priorities: ${cfg.campaigns}` : ""}
${cfg.notes ? `Notes: ${cfg.notes}` : ""}

Products available for static slots (pick exact names):
${productList}

Brand USPs: ${ctx.usps.slice(0, 8).join(" | ") || "(none)"}

Brand context (voice/positioning):
${ctx.brandIntel.slice(0, 3500)}

Return exactly ${count} JSON array elements.`;
}

function parseSlots(text: string): SlotSpec[] {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!cleaned.startsWith("[")) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) cleaned = m[0];
  }
  const arr = JSON.parse(cleaned);
  if (!Array.isArray(arr)) throw new Error("Planner did not return an array");
  return arr.map((s: Record<string, unknown>) => ({
    assetType: s.assetType === "static" ? "static" : "video",
    format: ["feed", "story", "reel"].includes(String(s.format)) ? (s.format as SlotSpec["format"]) : "feed",
    angleTag: String(s.angleTag || "proof"),
    topic: String(s.topic || "").slice(0, 300),
    title: String(s.title || "Post").slice(0, 120),
    direction: String(s.direction || "").slice(0, 800),
    productName: s.productName ? String(s.productName) : null,
  }));
}

/**
 * Generate the plan for a whole monthly_plan: one Claude call per brand, then
 * insert plan_items zipped to computed dates. Flips the plan to plan_ready.
 */
export async function generateMonthPlan(planId: string): Promise<{ items: number }> {
  const [plan] = await db.select().from(schema.monthlyPlans).where(eq(schema.monthlyPlans.id, planId)).limit(1);
  if (!plan) throw new Error("Plan not found");
  const cfg = plan.inputConfig as PlanInputConfig;

  const [yearStr, monthStr] = cfg.month.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx0 = parseInt(monthStr, 10) - 1;
  const apiKey = await getApiKey("ANTHROPIC_API_KEY");

  let sortOrder = 0;
  let inserted = 0;

  for (const clientId of cfg.brands) {
    try {
      const ctx = await loadBrandContext(clientId);
      const canStatic = canProduceStatic(ctx);
      const count = Math.max(1, Math.min(60, cfg.postsPerBrand));
      const dates = spreadDates(year, monthIdx0, count, ctx.prefs.daysOfWeek);
      if (dates.length === 0) continue;

      const { text } = await callClaude({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(ctx, dates.length, cfg, canStatic) }],
        maxTokens: 8000,
        budgetTokens: 3000,
        apiKey,
      });
      let slots = parseSlots(text);
      // Pad/truncate to match dates.
      if (slots.length < dates.length) {
        const angles = CORE_ANGLES;
        for (let i = slots.length; i < dates.length; i++) {
          slots.push({ assetType: canStatic ? "static" : "video", format: "feed", angleTag: angles[i % angles.length].tag, topic: cfg.themes || "Brand post", title: "Post", direction: "", productName: null });
        }
      }
      slots = slots.slice(0, dates.length);

      const productByName = new Map(ctx.staticEligibleProducts.map((p) => [p.name.toLowerCase(), p]));
      const heroFallback = ctx.staticEligibleProducts.find((p) => p.isHero) || ctx.staticEligibleProducts[0];

      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        // Enforce eligibility: static requires a resolvable product.
        let assetType = s.assetType;
        let productId: string | null = null;
        if (assetType === "static") {
          if (!canStatic) {
            assetType = "video";
          } else {
            const prod = (s.productName && productByName.get(s.productName.toLowerCase())) || heroFallback;
            if (prod) productId = prod.id;
            else assetType = "video";
          }
        }
        const format = assetType === "video" ? (s.format === "feed" ? "reel" : s.format) : s.format;

        await db.insert(schema.planItems).values({
          planId,
          clientId,
          plannedDate: dates[i],
          assetType,
          format,
          platforms: cfg.platforms,
          angleTag: s.angleTag,
          topic: s.topic,
          productId,
          title: s.title,
          direction: s.direction,
          status: "planned",
          sortOrder: sortOrder++,
        });
        inserted++;
      }
    } catch (err) {
      console.error(`[monthly-planning/planner] brand ${clientId} failed:`, err);
      // Skip this brand; others still plan.
    }
  }

  await db
    .update(schema.monthlyPlans)
    .set({ status: inserted > 0 ? "plan_ready" : "error", errorMessage: inserted > 0 ? null : "No plan items could be generated", updatedAt: new Date() })
    .where(eq(schema.monthlyPlans.id, planId));

  return { items: inserted };
}
