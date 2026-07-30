/**
 * Static-Ad Prompt Builder — pipeline stages A–F.
 *
 * Stages A–C are the LLM-heavy research/study work (where Daniel's quality comes
 * from). Stages E–F (authoring) are DETERMINISTIC slot-fills of the fixed master
 * templates — this guarantees the runtime output contract can never be broken by
 * an LLM rewrite, while still capturing all brand specificity Daniel injects
 * (the verbatim visual-language modifier, hex substitutions, the studied
 * product/service catalog, brand-voice rules).
 */

import { callOpus, callOpusJSON, imageBlock, WEB_TOOLS } from "./claude";
import { tavilyMap, tavilyExtract, fetchMetaAdImages } from "./research";
import { renderAgent1, renderAgent2 } from "./templates";
import type { BrandDNA, BuildContext, ItemStudy, VibeProfile } from "./types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Tailwind-500/600 palette values. Many Adly brands were bulk-imported with an
 * auto-assigned Tailwind colour rather than their real brand colour, so a
 * brandColor matching one of these is almost certainly a DEFAULT, not researched.
 * We must NOT anchor the generated palette on these — the live-site research is
 * the source of truth.
 */
const TAILWIND_DEFAULTS = new Set(
  [
    "#ef4444", "#dc2626", "#f97316", "#ea580c", "#f59e0b", "#d97706", "#eab308", "#ca8a04",
    "#84cc16", "#65a30d", "#22c55e", "#16a34a", "#10b981", "#059669", "#14b8a6", "#0d9488",
    "#06b6d4", "#0891b2", "#0ea5e9", "#0284c7", "#3b82f6", "#2563eb", "#6366f1", "#4f46e5",
    "#8b5cf6", "#7c3aed", "#a855f7", "#9333ea", "#d946ef", "#c026d3", "#ec4899", "#db2777",
    "#f43f5e", "#e11d48", "#64748b", "#475569", "#334155", "#6b7280", "#4b5563",
  ].map((h) => h.toLowerCase()),
);

function isDefaultBrandColor(hex?: string | null): boolean {
  if (!hex) return true;
  return TAILWIND_DEFAULTS.has(hex.trim().toLowerCase());
}

/**
 * Sanitise a studied catalog paragraph before it becomes a "USE EXACTLY AS WRITTEN"
 * block: no real social handles, no real-person follower lines, no stale years,
 * no malformed hex (zero-width chars). Keeps brand-described colours intact.
 */
function sanitizeCatalogParagraph(text: string): string {
  const t = text
    // strip zero-width / non-breaking artifacts that corrupt hex strings
    .replace(/[​-‍﻿ ]/g, "")
    // RENDER-READINESS: NanoBanana renders [bracket] tokens literally. Replace
    // common placeholder tokens with plausible baked literals, then strip any
    // other leftover [...] token so no literal brackets reach the image model.
    .replace(/\[\s*@?\s*(?:user(?:name)?|handle)\s*\]/gi, "@creatorgrowth")
    .replace(/\[\s*(?:creator\s*name|name)\s*\]/gi, "Jordan M.")
    .replace(/\[\s*(?:follower\s*count|followers?|subscriber\s*count)\s*\]/gi, "18,200")
    .replace(/\[[^\]\n]{1,40}\]/g, "")
    // neutralise real @handles → a fabricated-looking handle (never a real person)
    .replace(/@[A-Za-z0-9_.]{2,}/g, "@creatorgrowth")
    // drop stale copyright years (avoid baking "© 2023" into every render)
    .replace(/©\s*20\d\d\s*/g, "");
  return t.replace(/[ \t]{2,}/g, " ").trim();
}

function deriveVertical(ctx: BuildContext): string {
  if (ctx.vertical && ctx.vertical.trim()) {
    return ctx.brandType === "services"
      ? `${ctx.vertical.trim()} services`
      : `DTC ${ctx.vertical.trim()}`;
  }
  return ctx.brandType === "services" ? "service-business" : "DTC consumer";
}

export function resolveReferenceImage(ctx: BuildContext): string | null {
  if (ctx.referenceUrls && ctx.referenceUrls.length) return ctx.referenceUrls[0];
  const seed = (process.env.STATIC_AD_REFERENCE_SEED_URL || "").trim();
  return seed || null;
}

// ─── Stage A — Brand DNA research (Opus + web tools + vision) ──────────────────

const RESEARCH_SYSTEM = `You are a Senior Brand Strategist conducting a full reverse-engineering of a target brand's visual and verbal identity. You produce a comprehensive BRAND DNA DOCUMENT used to write highly specific AI image-generation prompts. Every detail matters because the output is fed into an image model that needs exact specifications.

SEARCH FIRST. For any brand fact not directly visible in the inputs — design agency / who designed the branding, exact brand fonts, exact hex colours, packaging materials and finish, brand story/positioning, and 2–3 direct competitors — you MUST use web_search and web_fetch before answering, rather than answering from memory. Read the brand's own website thoroughly. Search the Meta Ad Library style of their current creative.

COLOUR ACCURACY IS CRITICAL. Determine the brand's REAL colours by examining the LIVE brand — its website (buttons, headers, links, hero sections), logo, and current ad creative. Report PRECISE hex values you actually observe, not approximations or guesses. The live brand is the single source of truth.

Prioritise the brand's FUNCTIONAL / WORKING palette — the colours that actually carry the brand in marketing: the primary CTA/button colour, the dominant text/heading colour, link/action colour, and the main background colours as they appear ON THE WEBSITE AND IN ADS. A logo is often a single saturated gradient or mark that is NOT the brand's working colour — treat the logo's colours as ACCENT / marketing colours, not automatically the primary, unless that same colour also dominates the site's buttons, headings, and backgrounds. (Example failure: a brand whose logo is a hot-pink gradient ring but whose actual UI text, CTAs and chrome are navy — the navy is the brand-carrying primary, the pink is an accent.) When the website/UI palette and the logo disagree, the website/UI palette wins for primary/secondary/text; the logo informs the accent + signature gradient.

If the input includes a "recorded brand colour", treat it as an UNVERIFIED hint only — verify it against the live site and OVERRIDE it if the real brand colours differ. Never anchor the palette on a colour you cannot confirm on the live brand; never infer a colour from the brand name. Capture the brand's full functional palette: primary (working CTA/brand colour), secondary, accent, dark/text, light/background, and any signature logo gradient (with each stop's hex, labelled as accent/marketing use).

Produce the document in this exact structure:

BRAND OVERVIEW — Name / Tagline / Design Agency / 5 Voice Adjectives / Positioning / Competitive Differentiation
VISUAL SYSTEM — Primary Font / Secondary Font / Primary Colour [hex] / Secondary Colour [hex] / Accent Colour [hex] / Background Colours / CTA Colour and Style / Signature gradient (if any, with stops)
PHOTOGRAPHY DIRECTION — Lighting / Colour Grading / Composition / Subject Matter / Props and Surfaces / Mood
PRODUCT/SERVICE DETAILS — Physical or experiential description / Label-logo placement / Distinctive features / Packaging or platform system
AD CREATIVE STYLE — Typical formats / Text overlay style / Photo vs illustration / UGC usage / Offer presentation
PROOF POINTS — Specific reusable stats, numbers, ratings, guarantees and trust claims the brand actually uses (e.g. "55,000+ creators", "4.91★", "7-day money-back guarantee", "delivered by real humans"). List the concrete ones; these get reused verbatim in ad copy. Do NOT invent numbers.

End the document with a section headed exactly:
IMAGE GENERATION PROMPT MODIFIER:
followed by a single 50–75 word paragraph, written as one prose sentence-group, that can be prepended to ANY image prompt to match this brand's visual identity. It must begin "Shoot in the [Brand] visual language:" and include the brand's exact observed hex colours, font descriptions, photography direction, and mood.`;

export async function runResearch(ctx: BuildContext): Promise<BrandDNA> {
  // Best-effort supplements gathered first (degrade to empty).
  const sources: string[] = [];
  const supplements: string[] = [];

  if (ctx.website) {
    const mapped = await tavilyMap(ctx.website, { maxResults: 40 });
    sources.push(...mapped);
    if (mapped.length) {
      const extracted = await tavilyExtract(mapped.slice(0, 6));
      for (const e of extracted) supplements.push(`SOURCE ${e.url}\n${e.content}`);
    }
  }
  const adImages = await fetchMetaAdImages(ctx.brandName, { limit: 6 });

  // Vision inputs: logo + up to 4 ad creatives.
  const visionUrls = [ctx.logoUrl, ...adImages].filter((u): u is string => !!u).slice(0, 5);
  const visionBlocks = [];
  for (const url of visionUrls) {
    try {
      visionBlocks.push(await imageBlock(url));
    } catch {
      /* skip unreadable image */
    }
  }

  // Guidelines-authoritative: when the agency has filled the Brand Guidelines
  // page (colours / fonts), those are CONFIRMED facts the research must use and
  // must not override — research only fills gaps. This is the high-accuracy
  // path. The DB brandColor counts as confirmed only when it's not a Tailwind
  // default. With nothing confirmed, research determines everything from the
  // live brand (the good-but-not-best path).
  const g = ctx.guidelines;
  const gc = g?.colors;
  // Working primary leads, then palette/secondary/accent/text/bg, gradient, status.
  const confirmedColors = [
    gc?.primary,
    ctx.brandColor && !isDefaultBrandColor(ctx.brandColor) ? ctx.brandColor : null,
    ...(gc?.palette ?? []),
    gc?.secondary,
    gc?.accent,
    gc?.text,
    gc?.background,
    ...(gc?.gradient ?? []),
    gc?.success,
    gc?.danger,
    gc?.warning,
  ].filter((h): h is string => !!h && /^#?[0-9a-f]{6}$/i.test(h.trim()) && !isDefaultBrandColor(h));
  const hasConfirmed =
    confirmedColors.length > 0 || !!g?.fonts?.heading || !!g?.fonts?.body || !!g?.fonts?.scale || !!g?.components;
  const colorLine = hasConfirmed
    ? `CONFIRMED BRAND GUIDELINES (AUTHORITATIVE — the agency entered these; use them EXACTLY in your VISUAL SYSTEM and the prompt modifier, and do NOT override them; research only to fill gaps):${
        confirmedColors.length ? `\n- Brand colours (primary first): ${confirmedColors.join(", ")}` : ""
      }${gc?.gradient?.length ? `\n- Signature gradient stops: ${gc.gradient.join(" → ")}` : ""}${
        [gc?.success ? `success ${gc.success}` : "", gc?.danger ? `danger ${gc.danger}` : "", gc?.warning ? `warning ${gc.warning}` : ""].filter(Boolean).length
          ? `\n- Status colours: ${[gc?.success ? `success ${gc.success}` : "", gc?.danger ? `danger ${gc.danger}` : "", gc?.warning ? `warning ${gc.warning}` : ""].filter(Boolean).join(", ")}`
          : ""
      }${g?.fonts?.heading ? `\n- Heading font: ${g.fonts.heading}` : ""}${g?.fonts?.body ? `\n- Body font: ${g.fonts.body}` : ""}${
        g?.fonts?.scale ? `\n- Type scale: ${g.fonts.scale}` : ""
      }${g?.components ? `\n- Component system: ${g.components}` : ""}`
    : "(No confirmed brand colours/fonts on file — determine the exact palette and typography from the live brand. Tip: fill the Brand Guidelines page for higher accuracy.)";

  const intel = ctx.brandIntel;
  const intelBlock = intel && (intel.identity || intel.audience || intel.usps || intel.voice || intel.constraints)
    ? `\nBRAND INTELLIGENCE the agency already recorded (ground your research in this; do not contradict it):\n${[
        intel.identity ? `Identity/Mission: ${intel.identity}` : "",
        intel.audience ? `Audience: ${intel.audience}` : "",
        intel.usps ? `USPs / proof: ${intel.usps}` : "",
        intel.voice ? `Voice & tone: ${intel.voice}` : "",
        intel.constraints ? `Constraints/guardrails: ${intel.constraints}` : "",
      ].filter(Boolean).join("\n").slice(0, 6000)}`
    : "";

  const userText = `Target Brand Name: ${ctx.brandName}
Target URL: ${ctx.website || "(none provided — search for the official site)"}
Brand type: ${ctx.brandType === "services" ? "Service Provider" : "Product Provider"}
${ctx.vertical ? `Vertical hint: ${ctx.vertical}` : ""}
${colorLine}${intelBlock}
${supplements.length ? `\nSITE CONTENT (pre-fetched, supplement your own searching):\n${supplements.join("\n\n").slice(0, 24000)}` : ""}
${visionBlocks.length ? "\n(Attached: brand logo and/or current ad creatives for visual analysis.)" : ""}

Produce the full BRAND DNA DOCUMENT now.`;

  const content: unknown[] = [...visionBlocks, { type: "text", text: userText }];

  const { text: document } = await callOpus({
    system: RESEARCH_SYSTEM,
    messages: [{ role: "user", content: content as never }],
    tools: WEB_TOOLS,
    effort: "high",
    maxTokens: 16000,
  });

  // Structured extraction of the machine-usable fields (no tools).
  const extracted = await callOpusJSON<{
    modifierParagraph: string;
    hexPalette: string[];
    headingFont: string;
    bodyFont: string;
    competitors: string[];
    proofPoints: string[];
  }>({
    system:
      "Extract structured fields from a BRAND DNA DOCUMENT. The modifierParagraph MUST be the verbatim paragraph that appears after 'IMAGE GENERATION PROMPT MODIFIER:' — copy it exactly, do not rewrite. hexPalette = the exact hex colours the document reports for the LIVE brand, primary first (do not invent or normalise). proofPoints = the concrete stats/ratings/guarantees from the PROOF POINTS section.",
    messages: [{ role: "user", content: `BRAND DNA DOCUMENT:\n\n${document}` }],
    effort: "low",
    maxTokens: 4000,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        modifierParagraph: { type: "string" },
        hexPalette: { type: "array", items: { type: "string" } },
        headingFont: { type: "string" },
        bodyFont: { type: "string" },
        competitors: { type: "array", items: { type: "string" } },
        proofPoints: { type: "array", items: { type: "string" } },
      },
      required: ["modifierParagraph", "hexPalette", "headingFont", "bodyFont", "competitors", "proofPoints"],
    },
  });

  // The RESEARCHED palette is the source of truth. Lead with it. Only fold in the
  // DB/guidelines colours if they're NOT auto-assigned defaults, and always after
  // the researched hexes so the substitution logic prefers what's real.
  const researched = extracted.hexPalette
    .filter((h) => !!h && /^#?[0-9a-f]{3,8}$/i.test(h.trim()))
    .map((h) => (h.startsWith("#") ? h : `#${h}`));

  // Guidelines-authoritative: confirmed guideline colours LEAD the palette (so
  // buildColorSubstitutions picks the guideline primary), with researched hexes
  // filling the rest. With no confirmed colours, the researched palette stands.
  const palette = confirmedColors.length
    ? Array.from(new Set([...confirmedColors.map((h) => (h.startsWith("#") ? h : `#${h}`)), ...researched]))
    : Array.from(new Set(researched));
  const paletteFromResearch =
    confirmedColors.length === 0 &&
    researched.length > 0 &&
    (!ctx.brandColor || !researched.some((h) => h.toLowerCase() === ctx.brandColor!.toLowerCase()));

  return {
    document,
    modifierParagraph: extracted.modifierParagraph?.trim() || "",
    hexPalette: palette.length ? palette : researched,
    fonts: {
      heading: ctx.guidelines?.fonts?.heading || extracted.headingFont || null,
      body: ctx.guidelines?.fonts?.body || extracted.bodyFont || null,
    },
    competitors: extracted.competitors ?? [],
    proofPoints: extracted.proofPoints ?? [],
    sources: Array.from(new Set(sources)).slice(0, 40),
    paletteFromResearch,
  };
}

// ─── Stage B — Vibe / emotional pass ───────────────────────────────────────────

export async function runVibe(ctx: BuildContext, dna: BrandDNA): Promise<VibeProfile> {
  const visionBlocks = [];
  if (ctx.logoUrl) {
    try {
      visionBlocks.push(await imageBlock(ctx.logoUrl));
    } catch {
      /* ignore */
    }
  }
  const result = await callOpusJSON<{ vibeParagraph: string; emotionalKeywords: string[] }>({
    system:
      "You are a brand strategist. Read the BRAND DNA DOCUMENT (and logo if attached) and describe, in detail, how this brand's visual identity should make a viewer FEEL — the vibe it gives off, the emotional register, the kind of person it speaks to. One rich paragraph + 5–8 emotional keywords.",
    messages: [
      {
        role: "user",
        content: [
          ...visionBlocks,
          { type: "text", text: `BRAND DNA DOCUMENT:\n\n${dna.document}` },
        ] as never,
      },
    ],
    effort: "medium",
    maxTokens: 2000,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        vibeParagraph: { type: "string" },
        emotionalKeywords: { type: "array", items: { type: "string" } },
      },
      required: ["vibeParagraph", "emotionalKeywords"],
    },
  });
  return result;
}

// ─── Stage C — Product / Service study (parallel per item) ─────────────────────

/** Strip leading meta-preamble an LLM sometimes emits before the real paragraph. */
function stripPreamble(text: string): string {
  let t = text.trim();
  // Drop a leading meta sentence/paragraph like "I have enough detail.", "Here is …", "Sure, …".
  const metaOpener = /^(?:okay|sure|alright|here(?:'s| is)\b|i (?:have|'ll|will|can)\b|let me\b)[^\n]*\.?\s*\n+/i;
  while (metaOpener.test(t)) t = t.replace(metaOpener, "").trim();
  return t;
}

export async function runStudy(ctx: BuildContext): Promise<ItemStudy[]> {
  const noun = ctx.brandType === "services" ? "service/offer" : "product";

  const studyOne = async (item: BuildContext["items"][number]): Promise<ItemStudy | null> => {
    try {
      const content: unknown[] = [];
      if (item.imageUrl) {
        try {
          content.push(await imageBlock(item.imageUrl));
        } catch {
          /* ignore unreadable */
        }
      }
      const promptText = `Study this ${noun} for ${ctx.brandName}${item.sourceUrl ? ` (page: ${item.sourceUrl})` : ""}.
Name: ${item.name}
${item.benefits ? `Known benefits: ${item.benefits}` : ""}

Write ONE dense paragraph describing all of its intricacies — for a product: physical form, materials, colours (with hex where visible), label/logo placement, finish (matte/gloss/frosted), distinctive features; for a service/offer: what it delivers, how it looks/works, the experience, the platform or deliverable surface. This paragraph will be used VERBATIM as the canonical description an image model uses to render it. Be precise and concrete.

COMPLIANCE & RENDER-READINESS: If the image shows real social-media handles, real person names, or specific follower/subscriber counts, do NOT transcribe them — replace them with PLAUSIBLE, FABRICATED-but-realistic baked literals (e.g. a made-up handle like "@growthwithmia", a name like "Mia R.", a concrete number like "12,403 followers"). NEVER use a bracketed placeholder token such as "[username]", "[follower count]", or "[name]" — the image model renders brackets as literal text. Never reproduce a real celebrity handle, third-party trademark text, or a copyright year ("© 2023"). Describe the brand's OWN product/UI faithfully, including its real UI colours.

Begin your reply IMMEDIATELY with the description itself. Do NOT write any preamble, acknowledgement, or meta-commentary ("Here is…", "I have enough detail…", "Sure…"). Output the paragraph and nothing else.`;
      content.push({ type: "text", text: promptText });

      const { text } = await callOpus({
        system:
          "You are a product/service analyst. Produce one precise, dense descriptive paragraph. Begin immediately with the description — never write 'Here is', 'I have', or any preamble/meta-commentary. Output only the paragraph.",
        messages: [{ role: "user", content: content as never }],
        // web_fetch only helps when there's a page to read (service items with a URL).
        tools: !item.imageUrl && item.sourceUrl ? WEB_TOOLS : undefined,
        effort: "medium",
        maxTokens: 1500,
      });
      return {
        name: item.name,
        sourceUrl: item.sourceUrl ?? null,
        imageUrl: item.imageUrl ?? null,
        paragraph: sanitizeCatalogParagraph(stripPreamble(text)),
      };
    } catch {
      return null;
    }
  };

  const results = await Promise.all(ctx.items.map(studyOne));
  return results.filter((r): r is ItemStudy => !!r && !!r.paragraph);
}

// ─── Stages E / F — deterministic authoring ────────────────────────────────────

export function assembleAgent1(ctx: BuildContext): string {
  return renderAgent1({ vertical: deriveVertical(ctx), brandType: ctx.brandType });
}

function buildColorSubstitutions(ctx: BuildContext, dna: BrandDNA): string {
  const gc = ctx.guidelines?.colors;
  const palette = dna.hexPalette.length ? dna.hexPalette : ctx.brandColor ? [ctx.brandColor] : ["#000000"];
  const sorted = [...palette].sort((a, b) => hexLuminance(a) - hexLuminance(b));
  // Role colours prefer explicit guideline roles, else infer from the (guideline-led) palette.
  const primary = gc?.primary || palette[0] || (!isDefaultBrandColor(ctx.brandColor) ? ctx.brandColor! : palette[0]);
  const text = gc?.text || sorted[0] || "#1A1A1A";
  const bg = gc?.background || sorted[sorted.length - 1] || "#FFFFFF";

  const lines = [
    `When the reference uses its brand's primary / CTA colour — substitute ${primary} (${ctx.brandName}'s primary).`,
    `When the reference uses dark type / headings — substitute ${text}.`,
    `When the reference uses light backgrounds / surfaces — substitute ${bg} or a near-white from the palette.`,
  ];
  if (gc?.secondary) lines.push(`When the reference uses a secondary/support colour — substitute ${gc.secondary}.`);
  if (gc?.accent) lines.push(`When the reference uses an accent / highlight — substitute ${gc.accent}.`);
  const status = [
    gc?.success ? `success → ${gc.success}` : "",
    gc?.danger ? `danger/urgency → ${gc.danger}` : "",
    gc?.warning ? `warning → ${gc.warning}` : "",
  ].filter(Boolean);
  if (status.length) lines.push(`Status colours: ${status.join(", ")}.`);
  if (gc?.gradient?.length) {
    lines.push(
      `Signature gradient (${gc.gradient.join(" → ")}) — reserved for marketing accents/hero shapes only, never as wallpaper.`,
    );
  }
  if (palette.length > 1) lines.push(`Full ${ctx.brandName} palette: ${palette.join(", ")}.`);
  // Brand-system depth (recovers what hand-crafted brand bibles encode).
  if (ctx.guidelines?.fonts?.scale) lines.push(`Type scale: ${ctx.guidelines.fonts.scale}.`);
  if (ctx.guidelines?.components) lines.push(`Component system: ${ctx.guidelines.components}.`);
  lines.push("These hexes are the brand's REAL colours — use them exactly; do not drift toward generic alternatives.");
  return lines.join("\n");
}

function buildCatalog(items: ItemStudy[]): string {
  if (!items.length) {
    return "(No specific products/services were supplied. Render the brand's own identity — logo, colours, typography — and compose brand-statement creative; never insert a generic placeholder product.)";
  }
  return items.map((i) => `${i.name.toUpperCase()}\n${i.paragraph}`).join("\n\n");
}

function buildVoiceRules(ctx: BuildContext, dna: BrandDNA, vibe: VibeProfile): string {
  const tone = ctx.guidelines?.tone;
  const intel = ctx.brandIntel;
  const lines: string[] = [];
  if (intel?.voice) lines.push(`Brand voice (from brand intel): ${intel.voice.trim()}`);
  if (tone?.keywords?.length) lines.push(`Voice keywords: ${tone.keywords.join(", ")}.`);
  if (vibe.emotionalKeywords?.length) lines.push(`Emotional register: ${vibe.emotionalKeywords.join(", ")}.`);
  if (tone?.notes) lines.push(tone.notes.trim());
  // Reusable proof points the copy should lean on instead of inventing claims.
  if (dna.proofPoints?.length) {
    lines.push(
      `Use these REAL proof points verbatim instead of inventing numbers — and never fabricate stats beyond them: ${dna.proofPoints.join("; ")}.`,
    );
  }
  if (intel?.usps) lines.push(`USPs to lean on: ${intel.usps.trim()}`);
  if (tone?.dos?.length) lines.push(`Do: ${tone.dos.join("; ")}.`);
  if (tone?.donts?.length) lines.push(`Don't: ${tone.donts.join("; ")}.`);
  // Compliance guardrails from brand intel (e.g. "never guarantee follower counts").
  if (intel?.constraints) lines.push(`Compliance/guardrails: ${intel.constraints.trim()}`);
  // Format-aware editorial discipline (recovers what hand-crafted prompts encode).
  lines.push(
    "Casing: follow the brand's own convention — Title Case for designed headlines/CTAs unless the brand is deliberately lowercase/UGC; keep casing consistent within a format.",
  );
  lines.push(
    "Punctuation & emoji by format: no exclamation marks or emoji in editorial/press/comparison formats; allow them sparingly only in UGC/story/chat formats. Short sentences. Periods for punch.",
  );
  lines.push(
    'Banned words: avoid hype clichés — "revolutionary", "game-changing", "incredible", "cutting-edge", "synergy", "supercharge", "unlock".',
  );
  lines.push(
    "Compliance: never promise a guaranteed specific result or number for an individual; never fabricate real social handles, real person names, or third-party star ratings — use only the verified proof points above.",
  );
  return lines.join("\n");
}

export function assembleAgent2(
  ctx: BuildContext,
  dna: BrandDNA,
  vibe: VibeProfile,
  items: ItemStudy[],
): string {
  return renderAgent2({
    brandName: ctx.brandName,
    brandType: ctx.brandType,
    visualLanguageModifier: dna.modifierParagraph,
    colorSubstitutions: buildColorSubstitutions(ctx, dna),
    catalog: buildCatalog(items),
    voiceRules: buildVoiceRules(ctx, dna, vibe),
  });
}
