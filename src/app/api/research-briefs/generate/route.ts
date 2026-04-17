import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getAppConfig } from "@/lib/config";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/research-briefs/generate
 * Async fire-and-forget brief generation from competitor ad or organic post.
 * Body: { sourceType, sourceId, clientId }
 * Returns 202 immediately. n8n calls /api/research-briefs/callback when done.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot generate briefs" }, { status: 403 });
  }

  const body = await req.json();
  const { sourceType, sourceId, clientId } = body;

  if (!sourceType || !sourceId || !clientId) {
    return NextResponse.json({ error: "sourceType, sourceId, and clientId are required" }, { status: 400 });
  }

  if (sourceType !== "competitor_ad" && sourceType !== "organic_post") {
    return NextResponse.json({ error: "sourceType must be 'competitor_ad' or 'organic_post'" }, { status: 400 });
  }

  // Fetch source data
  let sourceData: Record<string, unknown> | null = null;
  let mediaType = "static";

  if (sourceType === "competitor_ad") {
    const [ad] = await db
      .select()
      .from(schema.competitorAds)
      .where(eq(schema.competitorAds.id, sourceId))
      .limit(1);
    if (!ad) {
      return NextResponse.json({ error: "Competitor ad not found" }, { status: 404 });
    }
    sourceData = ad as unknown as Record<string, unknown>;
    const mt = (ad.mediaType || "").toLowerCase();
    mediaType = mt.includes("video") ? "video" : mt.includes("carousel") ? "carousel" : "static";
  } else {
    const [post] = await db
      .select()
      .from(schema.organicPosts)
      .where(eq(schema.organicPosts.id, sourceId))
      .limit(1);
    if (!post) {
      return NextResponse.json({ error: "Organic post not found" }, { status: 404 });
    }
    sourceData = post as unknown as Record<string, unknown>;
    const ct = (post.contentType || "").toLowerCase();
    mediaType = ct.includes("video") ? "video" : ct.includes("carousel") ? "carousel" : "static";
  }

  // Fetch brand intelligence for this specific client
  const brandIntelSections = await db
    .select()
    .from(schema.clientBrandIntelligence)
    .where(eq(schema.clientBrandIntelligence.clientId, clientId))
    .orderBy(schema.clientBrandIntelligence.sortOrder);

  const brandIntelligence = brandIntelSections.length > 0
    ? brandIntelSections.map((s) => `## ${s.title}\n\n${s.content || ""}`).join("\n\n")
    : null;

  // Insert brief row with "generating" status
  const [briefRow] = await db
    .insert(schema.researchBriefs)
    .values({
      clientId,
      userId: auth.portalUser.id,
      sourceType,
      sourceId,
      sourceSnapshot: sourceData,
      title: "Generating...",
      mediaType,
      fullBrief: {},
      status: "generating",
    })
    .returning();

  // Build webhook URL
  const config = await getAppConfig();
  const wfConfig = config?.workflows?.brief_generator as string | { webhook_path?: string; n8n_base_url?: string } | undefined;
  const webhookUrl = typeof wfConfig === "string"
    ? wfConfig
    : wfConfig?.webhook_path
      ? `${wfConfig.n8n_base_url || "https://studio-flow.app.n8n.cloud/webhook"}/${wfConfig.webhook_path}`
      : null;

  if (!webhookUrl) {
    await db
      .update(schema.researchBriefs)
      .set({ status: "error", errorMessage: "Brief generator webhook not configured", updatedAt: new Date() })
      .where(eq(schema.researchBriefs.id, briefRow.id));
    return NextResponse.json({ error: "Brief generator webhook not configured" }, { status: 500 });
  }

  // Fire-and-forget — don't await n8n response (avoids Cloudflare 524 timeout)
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        briefId: briefRow.id,
        sourceType,
        sourceData,
        brandIntelligence,
        mediaType,
        clientId,
      }),
    });

    if (!res.ok) {
      await db
        .update(schema.researchBriefs)
        .set({ status: "error", errorMessage: `n8n returned ${res.status}`, updatedAt: new Date() })
        .where(eq(schema.researchBriefs.id, briefRow.id));
      return NextResponse.json({ error: "Failed to trigger brief generation", briefId: briefRow.id }, { status: 502 });
    }
  } catch (err) {
    await db
      .update(schema.researchBriefs)
      .set({ status: "error", errorMessage: "Failed to reach n8n webhook", updatedAt: new Date() })
      .where(eq(schema.researchBriefs.id, briefRow.id));
    return NextResponse.json({ error: "Failed to reach brief generator", briefId: briefRow.id }, { status: 502 });
  }

  return NextResponse.json({ briefId: briefRow.id, status: "generating" }, { status: 202 });
}
