import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { toAccessibleUrl, r2KeyFromUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * GET /api/video-generation/gallery
 * List completed video generations with presigned URLs.
 * Supports ?clientId= for multi-client scoping.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const clientId = request.nextUrl.searchParams.get("clientId");

  const conditions = [eq(schema.videoGenerations.status, "completed")];
  if (clientId) {
    conditions.push(eq(schema.videoGenerations.clientId, clientId));
  }

  const rows = await db
    .select()
    .from(schema.videoGenerations)
    .where(and(...conditions))
    .orderBy(desc(schema.videoGenerations.createdAt));

  const withPreviews = await Promise.all(
    rows.map(async (row) => {
      let videoPreviewUrl = row.videoUrl;
      if (row.videoUrl && r2KeyFromUrl(row.videoUrl)) {
        videoPreviewUrl = await toAccessibleUrl(row.videoUrl);
      }
      return { ...row, videoPreviewUrl };
    })
  );

  return NextResponse.json(withPreviews);
}
