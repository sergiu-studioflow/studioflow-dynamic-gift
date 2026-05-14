import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * GET /api/static-ads/batch/[batchId]
 *
 * Returns every static_ad_generations row in the given batch, ordered by
 * batch_index. Used by the gallery detail dialog when the user opens a
 * batched card to view all sibling variations.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { batchId } = await params;
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.batchId, batchId))
      .orderBy(asc(schema.staticAdGenerations.batchIndex), asc(schema.staticAdGenerations.createdAt));

    if (rows.length === 0) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const variations = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        imageUrl: row.imageUrl ? await toAccessibleUrl(row.imageUrl) : null,
        thumbnailUrl: row.thumbnailUrl ? await toAccessibleUrl(row.thumbnailUrl) : null,
      }))
    );

    return NextResponse.json({
      batchId,
      batchSize: rows[0].batchSize,
      variations,
    });
  } catch (err) {
    console.error("[static-ads/batch]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
