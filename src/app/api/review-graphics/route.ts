import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";
import { sweepReviewGraphics, reconcileStuckParents } from "@/lib/reviews/poll-and-persist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/review-graphics?clientId=&status=
 * Lists generated review graphics (parent + per-format assets) for a brand.
 * Sweeps in-flight Kie jobs first so completed images surface immediately.
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const clientId = req.nextUrl.searchParams.get("clientId");
    const status = req.nextUrl.searchParams.get("status");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "60", 10), 200);

    // Progress any in-flight generations before reading.
    await sweepReviewGraphics({ clientId });
    await reconcileStuckParents(clientId);

    const conditions = [];
    if (clientId) conditions.push(eq(schema.reviewGraphics.clientId, clientId));
    if (status && status !== "all") conditions.push(eq(schema.reviewGraphics.status, status));

    const graphics = await db
      .select()
      .from(schema.reviewGraphics)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.reviewGraphics.createdAt))
      .limit(limit);

    if (graphics.length === 0) return NextResponse.json([]);

    const ids = graphics.map((g) => g.id);
    const assets = await db
      .select()
      .from(schema.reviewGraphicAssets)
      .where(inArray(schema.reviewGraphicAssets.graphicId, ids));

    const assetsByGraphic = new Map<string, typeof assets>();
    for (const a of assets) {
      const list = assetsByGraphic.get(a.graphicId) || [];
      list.push(a);
      assetsByGraphic.set(a.graphicId, list);
    }

    const result = await Promise.all(
      graphics.map(async (g) => {
        const list = assetsByGraphic.get(g.id) || [];
        const withUrls = await Promise.all(
          list.map(async (a) => ({
            id: a.id,
            format: a.format,
            aspectRatio: a.aspectRatio,
            status: a.status,
            errorMessage: a.errorMessage,
            imageUrl: a.imageUrl ? await toAccessibleUrl(a.imageUrl) : null,
          }))
        );
        // Stable format order: ig_feed, story, fb
        const order = { ig_feed: 0, story: 1, fb: 2 } as Record<string, number>;
        withUrls.sort((x, y) => (order[x.format] ?? 9) - (order[y.format] ?? 9));
        return { ...g, assets: withUrls };
      })
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[review-graphics] list", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
