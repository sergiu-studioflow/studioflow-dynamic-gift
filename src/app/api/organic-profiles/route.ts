import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq, and, asc, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/organic-profiles?platform=tiktok|instagram&clientId=xxx
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const platform = request.nextUrl.searchParams.get("platform");
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!platform || !["tiktok", "instagram"].includes(platform)) {
    return NextResponse.json({ error: "platform param required (tiktok or instagram)" }, { status: 400 });
  }

  const conditions = [eq(schema.organicProfiles.platform, platform)];
  if (clientId) conditions.push(eq(schema.organicProfiles.clientId, clientId));

  const profiles = await db
    .select()
    .from(schema.organicProfiles)
    .where(and(...conditions))
    .orderBy(asc(schema.organicProfiles.customLabel));

  // Get post counts per profile
  const postConditions = [eq(schema.organicPosts.platform, platform)];
  if (clientId) postConditions.push(eq(schema.organicPosts.clientId, clientId));

  const postCounts = await db
    .select({
      profileRef: schema.organicPosts.profileRef,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.organicPosts)
    .where(and(...postConditions))
    .groupBy(schema.organicPosts.profileRef);

  const countMap = new Map(postCounts.map((r) => [r.profileRef, r.count]));

  const result = profiles.map((p) => ({
    ...p,
    postCount: countMap.get(p.id) || 0,
  }));

  return NextResponse.json(result);
}

// POST /api/organic-profiles — create a new profile
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot add profiles" }, { status: 403 });
  }

  const { customLabel, profileUrl, platform, clientId } = await request.json();
  if (!customLabel?.trim() || !profileUrl?.trim() || !platform || !clientId) {
    return NextResponse.json({ error: "customLabel, profileUrl, platform, and clientId are required" }, { status: 400 });
  }

  if (!["tiktok", "instagram"].includes(platform)) {
    return NextResponse.json({ error: "platform must be tiktok or instagram" }, { status: 400 });
  }

  // Check for duplicate URL within this client
  const existing = await db
    .select({ id: schema.organicProfiles.id })
    .from(schema.organicProfiles)
    .where(
      and(
        eq(schema.organicProfiles.platform, platform),
        eq(schema.organicProfiles.profileUrl, profileUrl.trim()),
        eq(schema.organicProfiles.clientId, clientId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "This profile URL is already being tracked" }, { status: 409 });
  }

  const [profile] = await db
    .insert(schema.organicProfiles)
    .values({
      clientId,
      platform,
      customLabel: customLabel.trim(),
      profileUrl: profileUrl.trim(),
      trackingStatus: "Not Initialized",
    })
    .returning();

  return NextResponse.json(profile, { status: 201 });
}

// PATCH /api/organic-profiles — toggle tracking status
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot modify profiles" }, { status: 403 });
  }

  const { id, trackingStatus, clientId } = await request.json();
  if (!id || !trackingStatus) {
    return NextResponse.json({ error: "id and trackingStatus are required" }, { status: 400 });
  }

  const conditions = [eq(schema.organicProfiles.id, id)];
  if (clientId) conditions.push(eq(schema.organicProfiles.clientId, clientId));

  const [updated] = await db
    .update(schema.organicProfiles)
    .set({ trackingStatus })
    .where(and(...conditions))
    .returning();

  return NextResponse.json(updated);
}

// DELETE /api/organic-profiles — delete a profile
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete profiles" }, { status: 403 });
  }

  const { id, clientId } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const delConditions = [eq(schema.organicProfiles.id, id)];
  if (clientId) delConditions.push(eq(schema.organicProfiles.clientId, clientId));

  await db
    .delete(schema.organicProfiles)
    .where(and(...delConditions));

  return NextResponse.json({ deleted: true });
}
