import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq, desc, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/organic-posts?profile_id=X&clientId=Y
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const profileIdStr = request.nextUrl.searchParams.get("profile_id");
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!profileIdStr) {
    return NextResponse.json({ error: "profile_id param required" }, { status: 400 });
  }

  const profileId = parseInt(profileIdStr, 10);
  if (isNaN(profileId)) {
    return NextResponse.json({ error: "Invalid profile_id" }, { status: 400 });
  }

  const conditions = [eq(schema.organicPosts.profileRef, profileId)];
  if (clientId) conditions.push(eq(schema.organicPosts.clientId, clientId));

  const posts = await db
    .select()
    .from(schema.organicPosts)
    .where(and(...conditions))
    .orderBy(desc(schema.organicPosts.publishDate));

  return NextResponse.json({ posts });
}
