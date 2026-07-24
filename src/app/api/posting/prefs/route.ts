import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { resolvePrefs, type PostingPrefs } from "@/lib/posting/slots";

export const dynamic = "force-dynamic";

/** GET /api/posting/prefs?clientId=  → the brand's posting preferences (merged w/ defaults). */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const [brand] = await db.select({ settings: schema.brands.settings }).from(schema.brands).where(eq(schema.brands.id, clientId)).limit(1);
  return NextResponse.json(resolvePrefs((brand?.settings as Record<string, unknown>)?.posting));
}

/** PUT /api/posting/prefs  { clientId, prefs } → persist into brands.settings.posting. */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const { clientId, prefs } = body;
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const clean: PostingPrefs = resolvePrefs(prefs);
  const [brand] = await db.select({ settings: schema.brands.settings }).from(schema.brands).where(eq(schema.brands.id, clientId)).limit(1);
  const settings = { ...((brand?.settings as Record<string, unknown>) || {}), posting: clean };

  await db.update(schema.brands).set({ settings, updatedAt: new Date() }).where(eq(schema.brands.id, clientId));
  return NextResponse.json(clean);
}
