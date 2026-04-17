import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/organic-profiles/[id]/status — poll tracking status
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const profileId = parseInt(id, 10);
  if (isNaN(profileId)) {
    return NextResponse.json({ error: "Invalid profile ID" }, { status: 400 });
  }

  const [profile] = await db
    .select({
      trackingStatus: schema.organicProfiles.trackingStatus,
      username: schema.organicProfiles.username,
      displayName: schema.organicProfiles.displayName,
      avatarUrl: schema.organicProfiles.avatarUrl,
      followerCount: schema.organicProfiles.followerCount,
      totalPosts: schema.organicProfiles.totalPosts,
      lastScrapedAt: schema.organicProfiles.lastScrapedAt,
    })
    .from(schema.organicProfiles)
    .where(eq(schema.organicProfiles.id, profileId))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}
