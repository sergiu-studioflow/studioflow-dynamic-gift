/**
 * Checks on the user's script, shared by the Video Generation page and the generate route.
 *
 * A script that talks about "the product" with no product selected makes the prompt steps invent
 * one. On 30 Sep 2026 that produced a skincare serum in an Indigenous Promotions video. Requiring
 * the product is the fix; the (fixed) video prompts are not touched.
 */

const MENTIONS_PRODUCT = /\b(?:the|this|that|our|my|your|a|new)\s+products?\b/i;

export function scriptMentionsProduct(script: string): boolean {
  return MENTIONS_PRODUCT.test(script);
}

export const PRODUCT_REQUIRED_MESSAGE =
  "Your script mentions a product but none is selected. Pick one in the Product section, otherwise the video model makes one up.";
