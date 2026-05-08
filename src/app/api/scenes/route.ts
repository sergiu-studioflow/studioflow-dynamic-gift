import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { asc, eq, inArray, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { toAccessibleUrl, deleteFromR2, r2KeyFromUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const clientId = request.nextUrl.searchParams.get("clientId");
  const conditions = [];
  if (clientId) conditions.push(eq(schema.scenes.clientId, clientId));

  const rows = await db
    .select()
    .from(schema.scenes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schema.scenes.name));

  const withPreviews = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      imagePreviewUrl: await toAccessibleUrl(row.imageUrl),
    }))
  );

  return NextResponse.json(withPreviews);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot add scenes" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!body.imageUrl) {
    return NextResponse.json({ error: "Image is required" }, { status: 400 });
  }

  const [record] = await db
    .insert(schema.scenes)
    .values({
      clientId: body.clientId,
      name: body.name.trim(),
      imageUrl: body.imageUrl,
      description: body.description || null,
    })
    .returning();

  const imagePreviewUrl = await toAccessibleUrl(record.imageUrl);
  return NextResponse.json({ ...record, imagePreviewUrl }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete scenes" }, { status: 403 });
  }

  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No ids provided" }, { status: 400 });
  }

  // Read rows first so we can clean up R2 after the DB delete.
  const rows = await db
    .select({ id: schema.scenes.id, imageUrl: schema.scenes.imageUrl })
    .from(schema.scenes)
    .where(inArray(schema.scenes.id, ids));

  await db.delete(schema.scenes).where(inArray(schema.scenes.id, ids));

  // Best-effort R2 cleanup.
  for (const row of rows) {
    if (!row.imageUrl) continue;
    const key = r2KeyFromUrl(row.imageUrl);
    if (!key) continue;
    try { await deleteFromR2(key); } catch (err) { console.warn(`[scenes/DELETE] R2 cleanup failed for ${row.imageUrl}:`, err); }
  }

  return NextResponse.json({ success: true });
}
