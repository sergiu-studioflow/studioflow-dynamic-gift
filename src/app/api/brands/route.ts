import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

// GET — list all active brands (sorted by sortOrder)
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const rows = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.isActive, true))
    .orderBy(asc(schema.brands.sortOrder), asc(schema.brands.name));

  return NextResponse.json(rows);
}

const createBrandSchema = z.object({
  name: z.string().min(1).max(200),
});

// POST — add a new brand (admin only)
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.format() }, { status: 400 });
  }

  // Get max sort order for new brand
  const existing = await db
    .select({ sortOrder: schema.brands.sortOrder })
    .from(schema.brands)
    .orderBy(asc(schema.brands.sortOrder));
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((r) => r.sortOrder)) + 1 : 0;

  try {
    const [brand] = await db
      .insert(schema.brands)
      .values({ name: parsed.data.name.trim(), sortOrder: nextOrder })
      .returning();

    await db.insert(schema.activityLog).values({
      userId: auth.portalUser.id,
      action: "brand_created",
      resourceType: "brand",
      resourceId: brand.id,
      details: { name: brand.name },
    });

    return NextResponse.json(brand, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return NextResponse.json({ error: "A brand with this name already exists" }, { status: 409 });
    }
    throw err;
  }
}
