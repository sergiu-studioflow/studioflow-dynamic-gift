import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { generateReviewGraphicForReview } from "@/lib/reviews/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/review-graphics/generate
 * Body: { clientId: string, limit?: number }
 *
 * Picks the most recent qualifying, un-rendered reviews for the brand and
 * generates a testimonial creative set (captions + per-format Kie jobs) for
 * each. Images finish asynchronously via the sweep; rows start as draft once
 * generated. Approval happens in the gallery.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  if (authResult.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId: string | undefined = body.clientId;
  const limit = Math.min(Math.max(parseInt(String(body.limit ?? 3), 10) || 3, 1), 10);

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  // Brand + tone context
  const [brand] = await db
    .select({ id: schema.brands.id, name: schema.brands.brandName })
    .from(schema.brands)
    .where(eq(schema.brands.id, clientId))
    .limit(1);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const intel = await db
    .select({ title: schema.clientBrandIntelligence.title, content: schema.clientBrandIntelligence.content })
    .from(schema.clientBrandIntelligence)
    .where(eq(schema.clientBrandIntelligence.clientId, clientId))
    .orderBy(asc(schema.clientBrandIntelligence.sortOrder))
    .limit(6);
  const brandContext = intel
    .map((s) => `## ${s.title}\n${s.content || ""}`)
    .join("\n\n")
    .trim() || null;

  // Either a specific review (picked from the Reviews tab) or the newest
  // qualifying un-rendered reviews (the bulk "generate next N" flow).
  const reviewId = typeof body.reviewId === "string" ? body.reviewId : null;
  const candidates = reviewId
    ? await db
        .select()
        .from(schema.reviews)
        .where(and(eq(schema.reviews.brandId, clientId), eq(schema.reviews.reviewId, reviewId)))
        .limit(1)
    : await db
        .select()
        .from(schema.reviews)
        .where(
          and(
            eq(schema.reviews.brandId, clientId),
            eq(schema.reviews.qualifiesForRender, true),
            eq(schema.reviews.rendered, false)
          )
        )
        .orderBy(desc(schema.reviews.publishedAt))
        .limit(limit);

  if (candidates.length === 0) {
    return NextResponse.json({
      generated: [],
      message: reviewId
        ? "Review not found for this brand."
        : "No new reviews with customer photos to generate from.",
    });
  }

  const generated: string[] = [];
  const errors: Array<{ reviewId: string; error: string }> = [];

  for (const review of candidates) {
    try {
      const graphicId = await generateReviewGraphicForReview({
        review,
        brandName: brand.name,
        userId: authResult.portalUser.id,
        brandContext,
      });
      generated.push(graphicId);
    } catch (err) {
      // Caption generation failed for this review — record and move on.
      errors.push({ reviewId: review.reviewId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ generated, count: generated.length, errors });
}
