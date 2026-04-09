import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { uploadToR2, toAccessibleUrl } from "@/lib/r2";
import { v4 as uuid } from "uuid";

export const dynamic = "force-dynamic";

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * GET /api/reference-library
 * List active references. Optional ?industry=beauty filter.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const industry = req.nextUrl.searchParams.get("industry");

  const conditions = [eq(schema.referenceAdLibrary.isActive, true)];
  if (industry) {
    conditions.push(eq(schema.referenceAdLibrary.industry, industry));
  }

  const refs = await db
    .select()
    .from(schema.referenceAdLibrary)
    .where(and(...conditions))
    .orderBy(schema.referenceAdLibrary.sortOrder);

  // Return both original R2 URL (for backend pipeline) and presigned URL (for display)
  const withPreviewUrls = await Promise.all(
    refs.map(async (ref) => ({
      ...ref,
      previewUrl: await toAccessibleUrl(ref.imageUrl),
      // imageUrl stays as the original R2 URL for backend use
    }))
  );

  return NextResponse.json(withPreviewUrls);
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
  const key = `shared/reference-ad-library/${slugify(industry)}/${uuid()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const imageUrl = await uploadToR2(key, buffer, file.type);

  const [ref] = await db
    .insert(schema.referenceAdLibrary)
    .values({ name, imageUrl, industry, adType, brand, tags })
    .returning();

  return NextResponse.json(ref, { status: 201 });
}
