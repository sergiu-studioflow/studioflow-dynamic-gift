/**
 * Re-encrypt GEMINI_API_KEY with the SAME secret variant as every other vault row.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/fix-gemini-key-encryption.ts
 *
 * Why this exists: the production API_KEYS_ENCRYPTION_SECRET (a Vercel env var)
 * carries a trailing newline, so getEncryptionKey() there hashes `secret + "\n"`.
 * ANTHROPIC / OPENAI / KIE / META were all written through the deployed portal
 * and are encrypted under that variant. GEMINI_API_KEY was written from a local
 * script, whose .env.local copy of the secret has no trailing newline — so in
 * PRODUCTION its decrypt throws, getApiKey() swallows the error and returns "",
 * and the Quality Control gate silently loses its primary vision provider.
 *
 * This rewrites that one row under the newline variant. Idempotent: if the row
 * already decrypts under the target variant, it does nothing.
 *
 * Never prints key material.
 */

import "dotenv/config";
import crypto from "crypto";
import postgres from "postgres";

const KEY_NAME = "GEMINI_API_KEY";

function keyFor(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

function decrypt(encrypted: string, secret: string): string | null {
  try {
    const [ivh, tagh, ct] = encrypted.split(":");
    if (!ivh || !tagh || !ct) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(ivh, "hex"));
    d.setAuthTag(Buffer.from(tagh, "hex"));
    return d.update(ct, "hex", "utf8") + d.final("utf8");
  } catch {
    return null;
  }
}

function encrypt(plaintext: string, secret: string): string {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const enc = c.update(plaintext, "utf8", "hex") + c.final("hex");
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc}`;
}

async function main() {
  const base = process.env.API_KEYS_ENCRYPTION_SECRET;
  if (!base) throw new Error("API_KEYS_ENCRYPTION_SECRET is not set");
  const PROD = base + "\n"; // the variant the deployed portal actually uses

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql`SELECT key_name, encrypted_value FROM api_keys ORDER BY key_name`;

    console.log("Before:");
    for (const r of rows) {
      const prod = decrypt(r.encrypted_value as string, PROD);
      const local = decrypt(r.encrypted_value as string, base);
      console.log(`  ${String(r.key_name).padEnd(24)} prod=${prod ? "OK" : "FAIL"}  local=${local ? "OK" : "FAIL"}`);
    }

    const row = rows.find((r) => r.key_name === KEY_NAME);
    if (!row) throw new Error(`${KEY_NAME} not in the vault`);

    if (decrypt(row.encrypted_value as string, PROD)) {
      console.log(`\n${KEY_NAME} already decrypts under the production variant — nothing to do.`);
      return;
    }
    const plaintext = decrypt(row.encrypted_value as string, base);
    if (!plaintext) throw new Error(`${KEY_NAME} decrypts under neither variant — re-enter it in Settings.`);

    await sql`
      UPDATE api_keys
      SET encrypted_value = ${encrypt(plaintext, PROD)}, updated_at = now()
      WHERE key_name = ${KEY_NAME}`;

    const after = await sql`SELECT key_name, encrypted_value FROM api_keys ORDER BY key_name`;
    console.log("\nAfter:");
    let allProd = true;
    for (const r of after) {
      const prod = decrypt(r.encrypted_value as string, PROD);
      if (!prod) allProd = false;
      console.log(`  ${String(r.key_name).padEnd(24)} prod=${prod ? `OK (${prod.length} chars)` : "FAIL"}`);
    }
    console.log(`\n${allProd ? "All vault keys now decrypt in production." : "SOME KEYS STILL FAIL — investigate."}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
