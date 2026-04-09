import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * GET /api/reference-library/random?industry=beauty
 * Return one random active reference from the industry.
 * Includes a presigned URL for preview (R2 is private).
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const industry = req.nextUrl.searchParams.get("industry");

  const conditions = [eq(schema.referenceAdLibrary.isActive, true)];
  if (industry) {
    conditions.push(eq(schema.referenceAdLibrary.industry, industry));
  }

  const [ref] = await db
    .select()
    .from(schema.referenceAdLibrary)
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(1);

  if (!ref) {
    return NextResponse.json({ error: "No references found" }, { status: 404 });
  }

  const previewUrl = await toAccessibleUrl(ref.imageUrl);

  return NextResponse.json({ ...ref, previewUrl });
}
