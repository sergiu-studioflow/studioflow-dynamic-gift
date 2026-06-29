import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/review-graphics/reviews?clientId=&filter=
 * Browse the scraped reviews for a brand.
 * filter: "qualifying" (default — 4★+ with a customer photo) | "all" | "rendered"
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const clientId = req.nextUrl.searchParams.get("clientId");
    const filter = req.nextUrl.searchParams.get("filter") || "qualifying";
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "60", 10), 200);
    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

    const conditions = [eq(schema.reviews.brandId, clientId)];
    if (filter === "qualifying") conditions.push(eq(schema.reviews.qualifiesForRender, true));
    if (filter === "rendered") conditions.push(eq(schema.reviews.rendered, true));

    const rows = await db
      .select({
        reviewId: schema.reviews.reviewId,
        reviewerName: schema.reviews.reviewerName,
        stars: schema.reviews.stars,
        text: schema.reviews.text,
        textTranslated: schema.reviews.textTranslated,
        reviewImageUrls: schema.reviews.reviewImageUrls,
        publishedAt: schema.reviews.publishedAt,
        qualifiesForRender: schema.reviews.qualifiesForRender,
        rendered: schema.reviews.rendered,
      })
      .from(schema.reviews)
      .where(and(...conditions))
      .orderBy(desc(schema.reviews.publishedAt))
      .limit(limit);

    // Counts for the brand (cheap aggregate)
    const [counts] = await db
      .select({
        total: schema.reviews.reviewId,
      })
      .from(schema.reviews)
      .where(eq(schema.reviews.brandId, clientId))
      .limit(1);

    const result = rows.map((r) => ({
      ...r,
      images: Array.isArray(r.reviewImageUrls) ? (r.reviewImageUrls as string[]) : [],
    }));

    return NextResponse.json({ reviews: result, hasData: !!counts });
  } catch (err) {
    console.error("[review-graphics/reviews]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
