/**
 * Static Ad System configuration.
 * Brand slug determines R2 storage paths and is set per portal via env var.
 */
const SLUG_RE = /^[a-z0-9-]+$/;
const RAW_BRAND_SLUG_ENV = process.env.BRAND_SLUG ?? "";
const TRIMMED_BRAND_SLUG = RAW_BRAND_SLUG_ENV.trim() || "dynamic-gift";

if (RAW_BRAND_SLUG_ENV && RAW_BRAND_SLUG_ENV !== TRIMMED_BRAND_SLUG) {
  console.warn(
    `[static-ads/config] BRAND_SLUG env var has surrounding whitespace ` +
    `(raw=${JSON.stringify(RAW_BRAND_SLUG_ENV)}). ` +
    `Self-healed to ${JSON.stringify(TRIMMED_BRAND_SLUG)} — please fix the env var ` +
    `(use printf, not echo).`
  );
}

if (!SLUG_RE.test(TRIMMED_BRAND_SLUG)) {
  throw new Error(
    `[static-ads/config] Invalid BRAND_SLUG ${JSON.stringify(RAW_BRAND_SLUG_ENV)} — ` +
    `must match ${SLUG_RE} (lowercase letters, digits, hyphens only).`
  );
}

export const BRAND_SLUG = TRIMMED_BRAND_SLUG;

/** R2 key prefix for this portal's assets */
export function r2Prefix(assetType: string): string {
  if (!assetType || /[\s/]/.test(assetType)) {
    throw new Error(`r2Prefix: invalid assetType ${JSON.stringify(assetType)} (no whitespace or slashes)`);
  }
  return BRAND_SLUG === "demo"
    ? `demo/${assetType}`
    : `brands/${BRAND_SLUG}/${assetType}`;
}

/** Valid aspect ratios for Kie AI */
export const VALID_ASPECT_RATIOS = ["auto", "1:1", "1:4", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** Max ad copy length */
export const MAX_AD_COPY_LENGTH = 5000;
