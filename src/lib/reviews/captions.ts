/**
 * Caption generation for the Review Scraping System.
 *
 * Ports the tested Claude system prompt from the original n8n workflow
 * (Dynamic Gift - Review Scraping System) into the portal-native Claude
 * client. Turns a real customer review into ready-to-post captions +
 * pull-quote for branded testimonial graphics.
 */

import { callClaude } from "@/lib/static-ads/anthropic";

export type ReviewCaptions = {
  pullQuote: string;
  instagramCaption: string;
  storiesCaption: string;
  facebookCaption: string;
  cta: string;
  hashtags: string[];
};

// Each brand writes as itself: the prompt names the selected brand and limits
// brand facts to its own review + brand intelligence (never a sister brand's).
function buildSystemPrompt(brandName: string): string {
  return `You are a social media copywriter for ${brandName}, a promotional products company. Your job: turn real customer reviews of ${brandName} into ready-to-post social media captions and pull-quotes for ${brandName}'s branded testimonial graphics.

# Output rules
- Output ONLY valid JSON. No markdown. No code fences. No explanation before or after the JSON.
- Use double quotes for all strings. Escape any internal quotes properly.
- Do not invent facts, products, or experiences not present in the review or in the ${brandName} brand context provided with it.
- Write only as ${brandName}: when the copy names the business, name ${brandName} — never another brand, including sister brands in the same group. Don't borrow facts, clients, projects, awards, review counts or history from any other brand.
- Reference the reviewer by their first name only (not full name).
- Match the tone to the brand: warm, professional, confident. Never sarcastic or overly casual.
- Use Australian English spelling and idiom.
- Every piece must include or imply a clear call-to-action (request a quote, get in touch, browse the range).
- If the review is too short or vague to support a long caption, keep captions on the shorter end of the allowed range rather than padding.

# Required output structure
{
  "pull_quote": "string — 6 to 12 words, scroll-stopping, pulled from or inspired by the review. No surrounding quotation marks in the value itself.",
  "instagram_caption": "string — 80 to 150 words, warm and conversational, references the reviewer by first name, ends with a CTA. NO hashtags in this field.",
  "stories_caption": "string — 20 to 40 words, punchy, optimized for vertical Stories format.",
  "facebook_caption": "string — 100 to 180 words, slightly more formal, suitable for B2B audience.",
  "cta": "string — one short call-to-action phrase, max 5 words.",
  "hashtags": ["array of 5 to 8 relevant hashtag strings WITHOUT the # symbol"]
}`;
}

/** Strip markdown code fences and parse the first JSON object in the text. */
function parseCaptionJson(text: string): ReviewCaptions {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ``` ... ``` wrappers if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Fall back to the first {...} block
  if (!cleaned.startsWith("{")) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
  }

  const obj = JSON.parse(cleaned);
  const hashtags = Array.isArray(obj.hashtags)
    ? obj.hashtags.map((h: unknown) => String(h).replace(/^#/, "").trim()).filter(Boolean)
    : [];

  return {
    pullQuote: String(obj.pull_quote || "").trim(),
    instagramCaption: String(obj.instagram_caption || "").trim(),
    storiesCaption: String(obj.stories_caption || "").trim(),
    facebookCaption: String(obj.facebook_caption || "").trim(),
    cta: String(obj.cta || "").trim(),
    hashtags,
  };
}

export async function generateReviewCaptions(input: {
  brandName: string;
  reviewerName: string | null;
  stars: number | null;
  text: string;
  brandContext?: string | null;
}): Promise<ReviewCaptions> {
  const brandContext = input.brandContext
    ? `\n\n${input.brandName} brand context (for tone and voice, and the only source of brand facts besides the review — do not quote verbatim):\n${input.brandContext.slice(0, 4000)}`
    : "";

  const userMessage =
    `Brand: ${input.brandName}\n` +
    `Reviewer: ${input.reviewerName || "Anonymous"}\n` +
    `Star rating: ${input.stars ?? "N/A"} stars\n` +
    `Review text: "${input.text}"` +
    brandContext +
    `\n\nGenerate the JSON content for this review.`;

  const { text } = await callClaude({
    system: buildSystemPrompt(input.brandName),
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 3000,
    budgetTokens: 1200,
  });

  return parseCaptionJson(text);
}
