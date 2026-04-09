import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, asc, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const productId = req.nextUrl.searchParams.get("productId");

    const styles = await db
      .select()
      .from(schema.adStyles)
      .where(eq(schema.adStyles.isActive, true))
      .orderBy(asc(schema.adStyles.sortOrder));

    if (!productId) {
      return NextResponse.json(styles);
    }

    // Get which styles have prompts for this product
    const prompts = await db
      .select({
        adStyleId: schema.adStylePrompts.adStyleId,
      })
      .from(schema.adStylePrompts)
      .where(eq(schema.adStylePrompts.productId, productId));

    const promptStyleIds = new Set(prompts.map((p) => p.adStyleId));

    const stylesWithAvailability = styles.map((style) => ({
      ...style,
      hasPrompt: promptStyleIds.has(style.id),
    }));

    return NextResponse.json(stylesWithAvailability);
  } catch (err) {
    console.error("[static-ads/styles]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
