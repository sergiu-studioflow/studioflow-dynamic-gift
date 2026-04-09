import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteFromR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [generation] = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.id, id))
      .limit(1);

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }

    // Clean up R2 asset if it exists
    if (generation.imageUrl && (generation.imageUrl.includes("r2.dev") || generation.imageUrl.includes("studio-flow.co"))) {
      try {
        // Extract key from URL by removing the domain prefix
        const key = generation.imageUrl.replace(/^https?:\/\/[^/]+\//, "");
        await deleteFromR2(key);
      } catch (r2Err) {
        console.error("[static-ads/delete] R2 cleanup failed:", r2Err);
        // Continue with DB deletion even if R2 cleanup fails
      }
    }

    await db
      .delete(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[static-ads/gallery/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
