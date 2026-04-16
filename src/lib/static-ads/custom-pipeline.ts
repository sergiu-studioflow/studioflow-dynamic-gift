/**
 * Multi-client custom static ad pipeline — two Claude agents with per-client prompts.
 * Agent 1: Analyze reference ad (vision) → structured JSON
 * Agent 2: Generate image prompt from analysis + product + copy
 *
 * Loads Agent 1 + Agent 2 system prompts from the client_static_ad_config table,
 * enabling different brand DNA per client (e.g., Dynamic Gift vs Indigenous Promotions).
 */

import { callClaude, imageUrlToBase64Block } from "./anthropic";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

export type ProductInfo = {
  name: string;
  imageUrl: string;
  visualDescription?: string | null;
  solution?: string | null;
  targetAudience?: string | null;
};

type ClientAdConfig = {
  agent1Prompt: string;
  agent2Prompt: string;
  brandLogoUrl: string | null;
};

// ═══════════════════════════════════════════════
// LOAD PER-CLIENT PROMPTS
// ═══════════════════════════════════════════════

const configCache = new Map<string, { config: ClientAdConfig; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getClientAdConfig(clientId: string): Promise<ClientAdConfig> {
  const cached = configCache.get(clientId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.config;
  }

  const [row] = await db
    .select()
    .from(schema.clientStaticAdConfig)
    .where(eq(schema.clientStaticAdConfig.clientId, clientId))
    .limit(1);

  if (!row) {
    throw new Error(`No static ad config found for client ${clientId}. Configure Agent 1 + Agent 2 prompts first.`);
  }

  const config: ClientAdConfig = {
    agent1Prompt: row.agent1Prompt,
    agent2Prompt: row.agent2Prompt,
    brandLogoUrl: row.brandLogoUrl || null,
  };

  configCache.set(clientId, { config, fetchedAt: Date.now() });
  return config;
}

// ═══════════════════════════════════════════════
// PIPELINE FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Agent 1: Analyze a reference ad image using Claude Vision.
 * Loads the client-specific Agent 1 system prompt from DB.
 * Returns the raw JSON analysis string.
 */
export async function analyzeReferenceAd(
  referenceImageUrl: string,
  clientId: string
): Promise<string> {
  const config = await getClientAdConfig(clientId);
  const imageBlock = await imageUrlToBase64Block(referenceImageUrl);

  const result = await callClaude({
    system: config.agent1Prompt,
    messages: [
      {
        role: "user",
        content: [
          imageBlock,
          { type: "text", text: "Analyse this advertisement image and output the structured JSON description." },
        ],
      },
    ],
    maxTokens: 16000,
    budgetTokens: 10000,
  });

  let text = result.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  try {
    JSON.parse(text);
  } catch {
    throw new Error("Agent 1 did not return valid JSON. Raw output: " + text.slice(0, 500));
  }

  return text;
}

/**
 * Agent 2: Generate an image generation prompt from analysis + product + copy.
 * Loads the client-specific Agent 2 system prompt (brand DNA) from DB.
 * Returns { prompt, metadata }.
 */
export async function generateCustomPrompt(params: {
  analysisJson: string;
  adCopy?: string;
  product: ProductInfo;
  referenceImageUrl: string;
  aspectRatio?: string;
  clientId: string;
}): Promise<{ prompt: string; metadata: string }> {
  const { analysisJson, adCopy, product, referenceImageUrl, aspectRatio, clientId } = params;

  const config = await getClientAdConfig(clientId);

  const userMessage = `Here are the inputs for this ad generation:

FORMAT BRIEF (from Agent 1 analysis):
${analysisJson}

PRODUCT SELECTION:
Name: ${product.name}
${product.visualDescription ? `Visual Description: ${product.visualDescription}` : ""}
${product.solution ? `Solution: ${product.solution}` : ""}
${product.targetAudience ? `Target Audience: ${product.targetAudience}` : ""}

USER COPY:
${adCopy?.trim() || "(No copy provided — generate ideal copy for this product and format from Brand DNA)"}

REQUIRED ASPECT RATIO: ${aspectRatio || "1:1"}
IMPORTANT: The final image MUST be generated in ${aspectRatio || "1:1"} aspect ratio. Override any aspect ratio from the reference ad analysis — the user has explicitly chosen ${aspectRatio || "1:1"}. End your prompt with "Aspect ratio: ${aspectRatio || "1:1"}" to ensure the image model respects this.

Write the image generation prompt now.`;

  const [refImageBlock, productImageBlock] = await Promise.all([
    imageUrlToBase64Block(referenceImageUrl),
    imageUrlToBase64Block(product.imageUrl),
  ]);

  const result = await callClaude({
    system: config.agent2Prompt,
    messages: [
      {
        role: "user",
        content: [
          refImageBlock,
          productImageBlock,
          { type: "text", text: userMessage },
        ],
      },
    ],
    maxTokens: 16000,
    budgetTokens: 10000,
  });

  const text = result.text.trim();

  const lastJsonStart = text.lastIndexOf("\n{");
  if (lastJsonStart === -1) {
    return { prompt: text, metadata: "{}" };
  }

  const prompt = text.slice(0, lastJsonStart).trim();
  let metadata = text.slice(lastJsonStart).trim();

  if (metadata.startsWith("```")) {
    metadata = metadata.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  return { prompt, metadata };
}
