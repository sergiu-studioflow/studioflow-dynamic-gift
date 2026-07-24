import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getApiKey } from "@/lib/api-keys";
import { getPageInfo, getIgUserInfo, MetaGraphError } from "@/lib/posting/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/posting/accounts/test  { id }
 * Hits the Graph API with the vault System User token to verify the page_id /
 * ig_user_id resolves. Persists the resolved name + health on the account row.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const [account] = await db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, body.id))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const token = (await getApiKey("META_SYSTEM_USER_TOKEN")).trim();
  if (!token) {
    return NextResponse.json(
      { error: "META_SYSTEM_USER_TOKEN is not configured. Add it in Settings → API Keys." },
      { status: 400 }
    );
  }

  try {
    const info =
      account.platform === "instagram"
        ? await getIgUserInfo(account.externalId, token)
        : await getPageInfo(account.externalId, token);
    const name = "username" in info ? info.username : info.name;

    const [updated] = await db
      .update(schema.socialAccounts)
      .set({ externalName: name, health: "ok", healthError: null, healthCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.socialAccounts.id, account.id))
      .returning();

    return NextResponse.json({ ok: true, account: updated });
  } catch (err) {
    const code = err instanceof MetaGraphError ? err.code : "error";
    const message = err instanceof Error ? err.message : "Connection failed";
    const health = code === "token_invalid" ? "token_invalid" : "error";

    const [updated] = await db
      .update(schema.socialAccounts)
      .set({ health, healthError: message, healthCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.socialAccounts.id, account.id))
      .returning();

    return NextResponse.json({ ok: false, error: message, account: updated }, { status: 200 });
  }
}
