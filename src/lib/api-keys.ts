/**
 * API Key management — encrypted storage with env var fallback.
 *
 * Keys are AES-256-GCM encrypted in the DB using API_KEYS_ENCRYPTION_SECRET.
 * getApiKey() checks DB first, falls back to process.env.
 */

import crypto from "crypto";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.API_KEYS_ENCRYPTION_SECRET;
  if (!secret) throw new Error("API_KEYS_ENCRYPTION_SECRET is not set");
  // Derive a 32-byte key from the secret
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decryptKey(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted key format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Mask an API key for display: show first 6 and last 4 chars.
 */
export function maskKey(key: string): string {
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/**
 * Get an API key — checks DB first (client-configured), falls back to env var.
 * Returns empty string if neither is set.
 */
export async function getApiKey(keyName: string): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyName, keyName));

    if (row?.encryptedValue) {
      return decryptKey(row.encryptedValue);
    }
  } catch {
    // DB read failed — fall back to env var
  }

  return (process.env[keyName] || "").trim();
}

/** The configurable keys and their metadata */
export const CONFIGURABLE_KEYS = [
  {
    keyName: "KIE_AI_API_KEY",
    label: "Kie AI",
    description: "Powers Static Ad image generation and Video Generation (Seedance 2)",
  },
  {
    keyName: "OPENAI_API_KEY",
    label: "OpenAI",
    description: "Powers Video Generation pipeline (Steps 2-3: GPT prompt expansion & cleanup)",
  },
  {
    keyName: "ANTHROPIC_API_KEY",
    label: "Anthropic Claude",
    description: "Powers Video Generation pipeline (Steps 1, 4, 5) and Static Ad creative analysis",
  },
  {
    keyName: "GEMINI_API_KEY",
    label: "Google Gemini",
    description: "Powers Meta Ads performance analysis and pattern detection",
  },
];
