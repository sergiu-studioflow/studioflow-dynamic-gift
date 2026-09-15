import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq, notInArray, or } from "drizzle-orm";
import { deleteFromR2, ownedR2Key } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";

export const dynamic = "force-dynamic";

/** Posts in these states no longer need their media file. */
const POST_DONE_STATUSES = ["cancelled", "published", "failed"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    if (authResult.portalUser.role === "viewer") {
      return NextResponse.json({ error: "Viewers cannot delete ads" }, { status: 403 });
    }

    const { id } = await params;

    const [generation] = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.id, id))
      .limit(1);

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }

    // A queued / scheduled post publishes straight from this ad's R2 file — deleting it
    // would make the post fail later, so refuse while any such post is still live.
    const [livePost] = await db
      .select({ status: schema.scheduledPosts.status })
      .from(schema.scheduledPosts)
      .where(
        and(
          generation.imageUrl
            ? or(
                eq(schema.scheduledPosts.sourceGenerationId, id),
                eq(schema.scheduledPosts.mediaUrl, generation.imageUrl)
              )
            : eq(schema.scheduledPosts.sourceGenerationId, id),
          notInArray(schema.scheduledPosts.status, POST_DONE_STATUSES)
        )
      )
      .limit(1);

    if (livePost) {
      return NextResponse.json(
        {
          error: `This ad is in the posting queue (post status: ${livePost.status}). Cancel or remove that post first, then delete the ad.`,
        },
        { status: 409 }
      );
    }

    // Remove the file only from this ad's own brand folder — the bucket is shared by
    // every StudioFlow brand. Anything else stays; the gallery row is still deleted.
    const key = generation.clientId
      ? ownedR2Key(generation.imageUrl, await getClientStoragePrefix(generation.clientId))
      : null;
    if (key) {
      try {
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
