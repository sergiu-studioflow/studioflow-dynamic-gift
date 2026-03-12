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
    .from(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  await db
    .update(schema.ideationRequests)
    .set({ status: "new", errorMessage: null, updatedAt: new Date() })
    .where(eq(schema.ideationRequests.id, id));

  // Delete any existing ideas from previous run
  await db
    .delete(schema.contentIdeas)
    .where(eq(schema.contentIdeas.requestId, id));

  const webhookBase =
    process.env.N8N_WEBHOOK_BASE || "https://studio-flow.app.n8n.cloud";
  const webhookUrl = `${webhookBase}/webhook/generate-dynamic-gift-ideation?requestId=${id}`;

  fetch(webhookUrl, { method: "GET" }).catch((err) => {
    console.error("Failed to trigger n8n webhook:", err);
  });

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ideation_request_retriggered",
    resourceType: "ideation_request",
    resourceId: id,
  });

  return NextResponse.json({ ok: true, status: "retriggered" });
}
