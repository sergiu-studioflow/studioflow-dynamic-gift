/**
 * Static Ad System configuration.
 * Brand slug determines R2 storage paths and is set per portal via env var.
 */
export const BRAND_SLUG = process.env.BRAND_SLUG || "dynamic-gift";

/** R2 key prefix for this portal's assets */
export function r2Prefix(assetType: string): string {
  return BRAND_SLUG === "demo"
    ? `demo/${assetType}`
    : `brands/${BRAND_SLUG}/${assetType}`;
}

/** Valid aspect ratios for Kie AI */
export const VALID_ASPECT_RATIOS = ["auto", "1:1", "1:4", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** Max ad copy length */
export const MAX_AD_COPY_LENGTH = 5000;
