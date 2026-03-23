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
    .from(schema.adCopyRequests)
    .where(eq(schema.adCopyRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  await db
    .update(schema.adCopyRequests)
    .set({ status: "new", errorMessage: null, updatedAt: new Date() })
    .where(eq(schema.adCopyRequests.id, id));

  // Delete any existing concepts from previous run
  await db
    .delete(schema.generatedAdCopy)
    .where(eq(schema.generatedAdCopy.requestId, id));

  const webhookBase =
    process.env.N8N_WEBHOOK_BASE || "https://studio-flow.app.n8n.cloud";
  const webhookUrl = `${webhookBase}/webhook/generate-dynamic-gift-ad-copy?requestId=${id}`;

  fetch(webhookUrl, { method: "GET" }).catch((err) => {
    console.error("Failed to trigger n8n webhook:", err);
  });

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ad_copy_request_retriggered",
    resourceType: "ad_copy_request",
    resourceId: id,
  });

  return NextResponse.json({ ok: true, status: "retriggered" });
}
