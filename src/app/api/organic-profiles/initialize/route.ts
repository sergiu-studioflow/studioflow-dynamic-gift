import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getAppConfig } from "@/lib/config";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/organic-profiles/initialize — trigger n8n scraper
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot initialize profiles" }, { status: 403 });
  }

  const { profileId, postsNumber, clientId } = await request.json();
  if (!profileId || !postsNumber) {
    return NextResponse.json({ error: "profileId and postsNumber are required" }, { status: 400 });
  }

  if (![50, 100, 200].includes(postsNumber)) {
    return NextResponse.json({ error: "postsNumber must be 50, 100, or 200" }, { status: 400 });
  }

  const [profile] = await db
    .select()
    .from(schema.organicProfiles)
    .where(eq(schema.organicProfiles.id, profileId))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  if (profile.trackingStatus === "Processing") {
    return NextResponse.json({ error: "Profile is already being processed" }, { status: 409 });
  }

  const config = await getAppConfig();
  const webhookKey = profile.platform === "tiktok"
    ? "organic_tiktok_scraper"
    : "organic_instagram_scraper";
  const wfConfig = config?.workflows?.[webhookKey] as string | { webhook_path?: string; n8n_base_url?: string } | undefined;
  const webhookUrl = typeof wfConfig === "string"
    ? wfConfig
    : wfConfig?.webhook_path
      ? `${wfConfig.n8n_base_url || "https://studio-flow.app.n8n.cloud/webhook"}/${wfConfig.webhook_path}`
      : null;

  if (!webhookUrl) {
    return NextResponse.json(
      { error: `${profile.platform} scraper webhook not configured. Add "${webhookKey}" to app_config workflows.` },
      { status: 500 }
    );
  }

  // Set status to Processing
  await db
    .update(schema.organicProfiles)
    .set({ trackingStatus: "Processing" })
    .where(eq(schema.organicProfiles.id, profileId));

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_url: profile.profileUrl,
        posts_number: postsNumber,
        client_id: clientId || profile.clientId,
      }),
    });

    if (!res.ok) {
      await db
        .update(schema.organicProfiles)
        .set({ trackingStatus: "Error" })
        .where(eq(schema.organicProfiles.id, profileId));
      return NextResponse.json({ error: "Failed to trigger scraper" }, { status: 502 });
    }

    return NextResponse.json({ triggered: true, profileId });
  } catch {
    await db
      .update(schema.organicProfiles)
      .set({ trackingStatus: "Error" })
      .where(eq(schema.organicProfiles.id, profileId));
    return NextResponse.json({ error: "Failed to reach n8n webhook" }, { status: 502 });
  }
}
