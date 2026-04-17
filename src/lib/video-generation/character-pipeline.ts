/**
 * Character Generation Pipeline
 *
 * Two modes: Likeness (inspired-by) and Identical (passport-style exact match)
 * Both: Upload image → Claude Vision analysis → Claude realism filter → Kie AI NB2
 */

import { callClaude, imageUrlToBase64Block } from "@/lib/static-ads/anthropic";
import { submitKieJob } from "@/lib/static-ads/kie-ai";

// ─────────────────────────────────────────────
// System Prompts
// ─────────────────────────────────────────────

const LIKENESS_AGENT1_SYSTEM = `Extract only the models likeness and the model alone into a extremely detailed high level JSON prompt then Adjust the JSON prompt so the shot is passport photo like shot`;

const LIKENESS_AGENT2_SYSTEM = `Keep the structure of JSON prompt the same, in terms of the model this will be a realism filter. I will give you some keywords to give you some ideas on ways in which we can make this model more realistic. You will then output the update to JSON with updated skin texture: vellus hair
visible pores
skin grain
micro skin texture
natural asymmetry
fine lines
crow's feet
under-eye creases
smile lines
subsurface redness
uneven pigmentation
freckles
sun spots
beauty marks
tiny blemishes
healed acne marks
small scars
broken capillaries
soft skin creasing
natural oil sheen
specular highlights
dry patches
dewy surface texture
follicular openings
micro bumps
texture breakup
tonal variation
authentic skin topography
light-catching micro texture
realistic epidermal detail`;

const IDENTICAL_AGENT1_SYSTEM = `Extract only the models likeness and the model alone into a extremely detailed high level JSON prompt then Adjust the JSON prompt so the shot is passport photo like shot`;

const IDENTICAL_AGENT2_SYSTEM = `At the start of the prompt, say, ensure this is a passport-like photo that looks exactly like the model attached but with a white background and the same clothes. Keep the structure of JSON prompt the same, in terms of the model this will be a realism filter. I will give you some keywords to give you some ideas on ways in which we can make this model more realistic. You will then output the update to JSON with updated skin texture: vellus hair
visible pores
skin grain
micro skin texture
natural asymmetry
fine lines
crow's feet
under-eye creases
smile lines
subsurface redness
uneven pigmentation
freckles
sun spots
beauty marks
tiny blemishes
healed acne marks
small scars
broken capillaries
soft skin creasing
natural oil sheen
specular highlights
dry patches
dewy surface texture
follicular openings
micro bumps
texture breakup
tonal variation
authentic skin topography
light-catching micro texture
realistic epidermal detail`;

// ─────────────────────────────────────────────
// Pipeline Steps
// ─────────────────────────────────────────────

export type CharacterMode = "likeness" | "identical";

/**
 * Step 1: Analyze source image with Claude Vision
 * Returns a detailed JSON prompt describing the person's likeness
 */
export async function analyzeCharacterLikeness(
  sourceImageUrl: string,
  mode: CharacterMode
): Promise<string> {
  const imageBlock = await imageUrlToBase64Block(sourceImageUrl);
  const systemPrompt = mode === "identical" ? IDENTICAL_AGENT1_SYSTEM : LIKENESS_AGENT1_SYSTEM;

  const result = await callClaude({
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          imageBlock,
          { type: "text", text: "Analyze this person and create the detailed JSON prompt." },
        ],
      },
    ],
    maxTokens: 8000,
    budgetTokens: 4000,
  });

  return result.text;
}

/**
 * Step 2: Apply realism skin texture filter
 * Enhances the JSON prompt with realistic skin details
 */
export async function applyRealismFilter(
  likenessJson: string,
  mode: CharacterMode
): Promise<string> {
  const systemPrompt = mode === "identical" ? IDENTICAL_AGENT2_SYSTEM : LIKENESS_AGENT2_SYSTEM;

  const result = await callClaude({
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: likenessJson,
      },
    ],
    maxTokens: 8000,
    budgetTokens: 4000,
  });

  return result.text;
}

/**
 * Extract a short human-readable physical description from the likeness JSON.
 * Used to store in the character record for pipeline consistency.
 */
export async function extractPhysicalDescription(
  likenessJson: string
): Promise<string> {
  const result = await callClaude({
    system: `Extract a concise one-line physical description from this character analysis JSON. Format: "Gender, age range, ethnicity, hair description, eye color, skin tone, notable features (glasses, facial hair, jewelry, etc.)". Output ONLY the description line, nothing else.`,
    messages: [
      { role: "user", content: likenessJson },
    ],
    maxTokens: 500,
    budgetTokens: 200,
  });
  return result.text.trim();
}

/**
 * Step 3: Submit to Kie AI Nano Banana 2 for image generation
 * Returns a taskId for polling
 */
export async function submitCharacterGeneration(
  prompt: string,
  sourceImageUrl?: string
): Promise<string> {
  const imageUrls = sourceImageUrl ? [sourceImageUrl] : [];

  const result = await submitKieJob({
    prompt,
    imageUrls,
    aspectRatio: "9:16",
    resolution: "1K",
    outputFormat: "png",
  });

  return result.taskId;
}
