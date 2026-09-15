import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { encryptKey, decryptKey, maskKey, CONFIGURABLE_KEYS } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

// These are the production credentials every generation system runs on (and pays with), so
// changing or removing one is admin-only. Members can still see which keys are set.
const adminOnly = () => NextResponse.json({ error: "Only admins can change API keys" }, { status: 403 });

const envDefault = (keyName: string) => (process.env[keyName] || "").trim();

/**
 * GET /api/settings/api-keys
 * Returns all configurable keys with masked values and status.
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const dbKeys = await db.select().from(schema.apiKeys);
  const dbKeyMap = new Map(dbKeys.map((k) => [k.keyName, k]));

  const result = CONFIGURABLE_KEYS.map((cfg) => {
    const dbRow = dbKeyMap.get(cfg.keyName);
    const envVal = envDefault(cfg.keyName);
    let source: "custom" | "default" | "not_set" = "not_set";
    let maskedValue = "";

    if (dbRow) {
      try {
        const raw = decryptKey(dbRow.encryptedValue);
        maskedValue = maskKey(raw);
        source = "custom";
      } catch {
        maskedValue = "Decryption error";
        source = "custom";
      }
    } else if (envVal) {
      maskedValue = maskKey(envVal);
      source = "default";
    }

    return {
      keyName: cfg.keyName,
      label: cfg.label,
      description: cfg.description,
      source,
      maskedValue,
      /** Whether removing the custom key leaves a server default to fall back to. */
      hasDefault: !!envVal,
      updatedAt: dbRow?.updatedAt?.toISOString() || null,
    };
  });

  return NextResponse.json(result);
}

/**
 * PUT /api/settings/api-keys
 * Set or update an API key (admin only).
 * Body: { keyName: string, value: string }
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role !== "admin") return adminOnly();

  const body = await request.json();
  const { keyName, value } = body;

  if (!keyName || !value?.trim()) {
    return NextResponse.json({ error: "keyName and value are required" }, { status: 400 });
  }

  const validKey = CONFIGURABLE_KEYS.find((k) => k.keyName === keyName);
  if (!validKey) {
    return NextResponse.json({ error: "Invalid key name" }, { status: 400 });
  }

  const encrypted = encryptKey(value.trim());

  // Upsert
  const existing = await db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyName, keyName));

  if (existing.length > 0) {
    await db
      .update(schema.apiKeys)
      .set({
        encryptedValue: encrypted,
        updatedAt: new Date(),
        updatedBy: auth.portalUser.userId,
      })
      .where(eq(schema.apiKeys.keyName, keyName));
  } else {
    await db.insert(schema.apiKeys).values({
      keyName,
      encryptedValue: encrypted,
      label: validKey.label,
      description: validKey.description,
      updatedBy: auth.portalUser.userId,
    });
  }

  return NextResponse.json({ success: true, maskedValue: maskKey(value.trim()) });
}

/**
 * DELETE /api/settings/api-keys
 * Remove a custom key (admin only). The server's env value, when there is one, takes over;
 * otherwise features that need the key stop working until a new one is added.
 * Body: { keyName: string }
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role !== "admin") return adminOnly();

  const body = await request.json().catch(() => ({}));
  const { keyName } = body as { keyName?: string };

  if (!keyName) {
    return NextResponse.json({ error: "keyName is required" }, { status: 400 });
  }
  if (!CONFIGURABLE_KEYS.some((k) => k.keyName === keyName)) {
    return NextResponse.json({ error: "Invalid key name" }, { status: 400 });
  }

  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.keyName, keyName));

  return NextResponse.json({ success: true, fallback: envDefault(keyName) ? "default" : "none" });
}
