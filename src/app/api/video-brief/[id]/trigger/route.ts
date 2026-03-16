import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  await db
    .update(schema.videoBriefRequests)
    .set({ status: "submitted", errorMessage: null, updatedAt: new Date() })
    .where(eq(schema.videoBriefRequests.id, id));

  // Delete any existing briefs from previous run
  await db
    .delete(schema.generatedVideoBriefs)
    .where(eq(schema.generatedVideoBriefs.requestId, id));

  const webhookBase =
    process.env.N8N_WEBHOOK_BASE || "https://studio-flow.app.n8n.cloud";
  const webhookUrl = `${webhookBase}/webhook/generate-dynamic-gift-video-brief?requestId=${id}`;

  fetch(webhookUrl, { method: "GET" }).catch((err) => {
    console.error("Failed to trigger n8n webhook:", err);
  });

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "video_brief_request_retriggered",
    resourceType: "video_brief_request",
    resourceId: id,
  });

  return NextResponse.json({ ok: true, status: "retriggered" });
}
