import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const status = req.nextUrl.searchParams.get("status");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "100"), 200);
    const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");

    const conditions = [];
    if (status && status !== "all") {
      conditions.push(eq(schema.staticAdGenerations.status, status));
    }

    const generations = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.staticAdGenerations.createdAt))
      .limit(limit)
      .offset(offset);

    // Generate presigned URLs for images (R2 bucket is private)
    const withAccessibleUrls = await Promise.all(
      generations.map(async (gen) => ({
        ...gen,
        imageUrl: gen.imageUrl ? await toAccessibleUrl(gen.imageUrl) : null,
        thumbnailUrl: gen.thumbnailUrl ? await toAccessibleUrl(gen.thumbnailUrl) : null,
      }))
    );

    return NextResponse.json(withAccessibleUrls);
  } catch (err) {
    console.error("[static-ads/gallery]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
