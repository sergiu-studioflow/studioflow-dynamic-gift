import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, asc } from "drizzle-orm";
import { isPlatformKey } from "@/lib/posting/platforms";

export const dynamic = "force-dynamic";

/**
 * GET /api/posting/accounts?clientId=
 * List social accounts for a brand (optionally all brands). Includes rows for
 * every platform so the UI can render "not connected" placeholders.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const clientId = req.nextUrl.searchParams.get("clientId");
  const rows = await db
    .select()
    .from(schema.socialAccounts)
    .where(clientId ? eq(schema.socialAccounts.clientId, clientId) : undefined)
    .orderBy(asc(schema.socialAccounts.platform));

  return NextResponse.json(rows);
}

/**
 * POST /api/posting/accounts
 * Body: { clientId, platform, externalId, enabled? }
 * Upserts the (clientId, platform) row. Stephen fills these in once per brand.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { clientId, platform, externalId } = body;
  const enabled = body.enabled !== false;

  if (!clientId || !isPlatformKey(platform) || !externalId || typeof externalId !== "string") {
    return NextResponse.json({ error: "clientId, platform (facebook|instagram), and externalId are required" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.clientId, clientId), eq(schema.socialAccounts.platform, platform)))
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(schema.socialAccounts)
      .set({ externalId: externalId.trim(), enabled, health: "unverified", healthError: null, updatedAt: new Date() })
      .where(eq(schema.socialAccounts.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(schema.socialAccounts)
      .values({ clientId, platform, externalId: externalId.trim(), enabled })
      .returning();
  }

  return NextResponse.json(row);
}

/**
 * PATCH /api/posting/accounts
 * Body: { id, enabled?, externalId? } — toggle or edit an existing account.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: Partial<typeof schema.socialAccounts.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.externalId === "string" && body.externalId.trim()) {
    update.externalId = body.externalId.trim();
    update.health = "unverified";
    update.healthError = null;
  }

  const [row] = await db
    .update(schema.socialAccounts)
    .set(update)
    .where(eq(schema.socialAccounts.id, body.id))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(row);
}
