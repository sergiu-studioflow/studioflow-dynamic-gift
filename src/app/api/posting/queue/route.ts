import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { queuePost } from "@/lib/posting/queue";
import { SourceError, type SourceType } from "@/lib/posting/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // one inline Claude call + media re-encode

const VALID_SOURCE_TYPES: SourceType[] = ["static_ad", "winner", "video", "review_graphic"];

/**
 * POST /api/posting/queue
 * Body: { sourceType, sourceId, platforms? }
 * Loads the source, generates captions, and drops a draft into the queue.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { sourceType, sourceId, platforms } = body;

  if (!VALID_SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ error: `sourceType must be one of ${VALID_SOURCE_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!sourceId || typeof sourceId !== "string") {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  }

  try {
    const result = await queuePost({
      sourceType,
      sourceId,
      userId: auth.portalUser.id,
      platforms: Array.isArray(platforms) ? platforms : undefined,
    });

    await db.insert(schema.activityLog).values({
      userId: auth.portalUser.id,
      clientId: result.clientId,
      action: "post_queued",
      resourceType: "scheduled_post",
      resourceId: result.postId,
      details: { sourceType, sourceId },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SourceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[posting/queue]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to queue post" },
      { status: 500 }
    );
  }
}
