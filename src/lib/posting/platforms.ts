/**
 * Scheduling + Auto-Posting — platform definitions.
 *
 * Each platform carries its own tone norms, caption/hashtag caps and preview
 * cutoff. These drive (1) the caption-generation prompt, (2) the code-side
 * clamps in captions.ts, and (3) the UI char counters + hashtag chips.
 *
 * v1 = Facebook + Instagram. LinkedIn is added here (with a `w_organization_social`
 * norms block) when Phase 3 LinkedIn posting ships.
 */

export type PlatformKey = "facebook" | "instagram";
export type Placement = "feed" | "story" | "reel";

export interface PlatformDef {
  key: PlatformKey;
  label: string;
  /** Flag (hard clamp) above this many caption characters. */
  captionHardMax: number;
  /** Soft flag above this — "long for this platform". */
  captionIdealMax: number;
  /** The hook must land before this many characters (feed truncation). */
  previewCutoff: number;
  hashtagMin: number;
  hashtagMax: number;
  /** Prompt block: tone, structure, CTA register for this platform. */
  norms: string;
}

export const PLATFORMS: Record<PlatformKey, PlatformDef> = {
  instagram: {
    key: "instagram",
    label: "Instagram",
    captionHardMax: 2200,
    captionIdealMax: 300,
    previewCutoff: 125,
    hashtagMin: 3,
    hashtagMax: 12,
    norms:
      "Instagram feed post for a B2B promotional-products brand. The first ~125 characters show before '…more' — the hook must land there. Write a save/share-worthy caption: hook line, then 1–3 short scannable paragraphs (line breaks between), one soft CTA at the end (request a quote / get in touch / browse the range). Warm, professional, confident brand voice — NOT paid-ad copy. Australian English. Emojis sparingly. Do NOT put hashtags inside the caption — they are returned separately.",
  },
  facebook: {
    key: "facebook",
    label: "Facebook",
    captionHardMax: 3000,
    captionIdealMax: 500,
    previewCutoff: 125,
    hashtagMin: 0,
    hashtagMax: 3,
    norms:
      "Facebook Page post for a B2B promotional-products brand. Slightly fuller than Instagram — conversational, story-friendly, community-toned (the audience skews older and more procurement-minded). Hook in the first ~125 characters, short paragraphs, one clear soft CTA. Australian English. Hashtags carry little weight on Facebook: 0–3 max, only if genuinely natural.",
  },
};

export const ALL_PLATFORM_KEYS = Object.keys(PLATFORMS) as PlatformKey[];

export function isPlatformKey(v: unknown): v is PlatformKey {
  // Own-property check — `in` walks the prototype chain, so "constructor" /
  // "__proto__" would pass validation and persist as garbage channels.
  return typeof v === "string" && Object.hasOwn(PLATFORMS, v);
}

/** Clamp a hashtag array to the platform's max and strip leading '#'. */
export function clampHashtags(platform: PlatformKey, hashtags: string[]): string[] {
  const def = PLATFORMS[platform];
  return hashtags
    .map((h) => String(h).replace(/^#+/, "").trim())
    .filter(Boolean)
    .slice(0, def.hashtagMax);
}

/** Compose the final publish text: caption + a blank line + space-joined #hashtags. */
export function composePublishText(caption: string | null, hashtags: string[] | null): string {
  const cap = (caption || "").trim();
  const tags = (hashtags || []).map((h) => `#${String(h).replace(/^#+/, "").trim()}`).filter((t) => t.length > 1);
  if (!tags.length) return cap;
  return cap ? `${cap}\n\n${tags.join(" ")}` : tags.join(" ");
}
