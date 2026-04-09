import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { asc, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

// GET /api/products — list all products (full details for brand-intel, id+name for forms)
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const full = request.nextUrl.searchParams.get("full") === "true";

  if (full) {
    const rows = await db
      .select()
      .from(schema.products)
      .orderBy(asc(schema.products.name));

    const withPreviews = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        imagePreviewUrl: row.imageUrl ? await toAccessibleUrl(row.imageUrl) : null,
        videoImagePreviewUrl: row.videoImageUrl ? await toAccessibleUrl(row.videoImageUrl) : null,
      }))
    );

    return NextResponse.json(withPreviews);
  }

  const rows = await db
    .select({ id: schema.products.id, name: schema.products.name })
    .from(schema.products)
    .orderBy(asc(schema.products.name));

  return NextResponse.json(rows);
}

// POST /api/products — create a new product
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot add products" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Product name is required" }, { status: 400 });
  }

  const [record] = await db
    .insert(schema.products)
    .values({
      name: body.name.trim(),
      targetAudience: body.targetAudience || null,
      solution: body.solution || null,
      painPoint: body.painPoint || null,
      brandDna: body.brandDna || null,
      imageUrl: body.imageUrl || null,
      videoImageUrl: body.videoImageUrl || null,
      visualDescription: body.visualDescription || null,
    })
    .returning();

  return NextResponse.json(record, { status: 201 });
}

// PATCH /api/products — update a product
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot edit products" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: "Product id is required" }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.targetAudience !== undefined) updates.targetAudience = body.targetAudience;
  if (body.solution !== undefined) updates.solution = body.solution;
  if (body.painPoint !== undefined) updates.painPoint = body.painPoint;
  if (body.brandDna !== undefined) updates.brandDna = body.brandDna;
  if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl;
  if (body.videoImageUrl !== undefined) updates.videoImageUrl = body.videoImageUrl;
  if (body.visualDescription !== undefined) updates.visualDescription = body.visualDescription;

  const [record] = await db
    .update(schema.products)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.products.id, body.id))
    .returning();

  return NextResponse.json(record);
}

// DELETE /api/products — bulk delete
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete products" }, { status: 403 });
  }

  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No ids provided" }, { status: 400 });
  }

  await db.delete(schema.products).where(inArray(schema.products.id, ids));
  return NextResponse.json({ success: true });
}
