import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { uploadToR2 } from "@/lib/r2";
import { v4 as uuid } from "uuid";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export const dynamic = "force-dynamic";

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * GET /api/reference-library?clientId=&industry=&scope=
 *
 * Reads the DATABASE. This route used to read an R2 manifest while every write
 * went to Postgres, so uploads and edits silently never appeared.
 *
 *   scope=brand   → only this brand's own references
 *   scope=shared  → only the shared pool
 *   (default)     → the brand's own references first, then the shared pool
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const industry = req.nextUrl.searchParams.get("industry");
  const clientId = req.nextUrl.searchParams.get("clientId");
  const scope = req.nextUrl.searchParams.get("scope");

  const conditions = [eq(schema.referenceAdLibrary.isActive, true)];
  if (industry) conditions.push(eq(schema.referenceAdLibrary.industry, industry));

  if (scope === "brand") {
    if (!clientId) return NextResponse.json([]);
    conditions.push(eq(schema.referenceAdLibrary.clientId, clientId));
  } else if (scope === "shared" || !clientId) {
    conditions.push(isNull(schema.referenceAdLibrary.clientId));
  } else {
    conditions.push(
      or(eq(schema.referenceAdLibrary.clientId, clientId), isNull(schema.referenceAdLibrary.clientId))!
    );
  }

  const rows = await db
    .select()
    .from(schema.referenceAdLibrary)
    .where(and(...conditions))
    // A brand's own references sort ahead of the shared pool.
    .orderBy(sql`${schema.referenceAdLibrary.clientId} IS NULL`, asc(schema.referenceAdLibrary.sortOrder));

  return NextResponse.json(
    rows.map((r) => ({ ...r, previewUrl: r.imageUrl, isShared: r.clientId === null }))
  );
}

/**
 * POST /api/reference-library
 * Upload a new reference image. Accepts FormData with file + name + industry.
 * Stores in shared R2 folder: shared/reference-ad-library/{industry}/{uuid}.{ext}
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const name = (formData.get("name") as string) || "Untitled";
  // A reference uploaded with a client selected belongs to THAT brand. Without a
  // client it joins the shared pool, preserving the old agency-wide behaviour.
  const clientId = (formData.get("clientId") as string) || null;
  const industry = (formData.get("industry") as string) || "beauty";
  const adType = (formData.get("adType") as string) || null;
  const brand = (formData.get("brand") as string) || null;
  const tags = (formData.get("tags") as string) || null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPEG, and WebP images allowed" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() || "jpeg";
  // Brand-owned references live under that brand's own R2 prefix; only the
  // agency-wide pool goes in shared/.
  const clientPrefix = clientId ? await getClientStoragePrefix(clientId) : null;
  const key = clientId && clientPrefix
    ? `${clientPrefix}/reference-library/${uuid()}.${ext}`
    : `shared/reference-ad-library/${slugify(industry)}/${uuid()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const imageUrl = await uploadToR2(key, buffer, file.type);

  const [ref] = await db
    .insert(schema.referenceAdLibrary)
    .values({ name, imageUrl, industry, adType, brand, tags, clientId })
    .returning();

  return NextResponse.json(ref, { status: 201 });
}
