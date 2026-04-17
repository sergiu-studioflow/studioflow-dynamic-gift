import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { asc, eq, inArray, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { toAccessibleUrl } from "@/lib/r2";

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

  await db.delete(schema.scenes).where(inArray(schema.scenes.id, ids));
  return NextResponse.json({ success: true });
}
