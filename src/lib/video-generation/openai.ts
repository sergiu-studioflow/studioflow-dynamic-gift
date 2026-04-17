import OpenAI from "openai";
import { getApiKey } from "@/lib/api-keys";

// Cache client per API key to avoid re-creating on every call
let _openai: OpenAI | null = null;
let _cachedKey: string | null = null;

async function getOpenAI(): Promise<OpenAI> {
  const apiKey = await getApiKey("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  // Re-create client if key changed (e.g. client updated their key)
  if (!_openai || _cachedKey !== apiKey) {
    _openai = new OpenAI({ apiKey });
    _cachedKey = apiKey;
  }
  return _openai;
}

export async function callGPT({
  systemPrompt,
  userMessage,
  model = "gpt-4.1",
}: {
  systemPrompt: string;
  userMessage: string;
  model?: string;
}): Promise<string> {
  const client = await getOpenAI();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 8192,
  });

  return response.choices[0]?.message?.content || "";
}
