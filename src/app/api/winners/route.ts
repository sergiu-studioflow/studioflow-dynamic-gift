import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { uploadToR2, toAccessibleUrl } from "@/lib/r2";
import { v4 as uuid } from "uuid";
import { r2Prefix } from "@/lib/static-ads/config";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/winners
 * List active winners with presigned preview URLs.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const clientId = req.nextUrl.searchParams.get("clientId");
  const conditions = [eq(schema.winnersLibrary.isActive, true)];
  if (clientId) {
    conditions.push(eq(schema.winnersLibrary.clientId, clientId));
  }

  const winners = await db
    .select()
    .from(schema.winnersLibrary)
    .where(and(...conditions))
    .orderBy(schema.winnersLibrary.createdAt);

  const withPreviews = await Promise.all(
    winners.map(async (w) => ({
      ...w,
      previewUrl: await toAccessibleUrl(w.imageUrl),
    }))
  );

  return NextResponse.json(withPreviews);
}

/**
 * POST /api/winners
 * Upload a new winner image. Accepts FormData with file + name + tags + notes.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const name = (formData.get("name") as string) || "Untitled";
  const tags = (formData.get("tags") as string) || null;
  const notes = (formData.get("notes") as string) || null;
  const productName = (formData.get("productName") as string) || null;
  const clientId = (formData.get("clientId") as string) || null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPEG, and WebP images allowed" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() || "jpeg";
  const clientPrefix = clientId ? await getClientStoragePrefix(clientId) : null;
  const basePrefix = clientPrefix ? `${clientPrefix}/winners-library` : r2Prefix("winners-library");
  const key = `${basePrefix}/${uuid()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const imageUrl = await uploadToR2(key, buffer, file.type);

  const [winner] = await db
    .insert(schema.winnersLibrary)
    .values({ userId: portalUser.id, clientId, name, imageUrl, tags, notes, productName })
    .returning();

  return NextResponse.json(winner, { status: 201 });
}
