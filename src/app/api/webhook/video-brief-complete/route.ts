import { db, schema } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { requestId, status } = body;

  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  // The n8n workflow already wrote briefs directly to Neon,
  // but we log the activity for the portal
  await db.insert(schema.activityLog).values({
    action: "video_brief_complete",
    resourceType: "video_brief_request",
    resourceId: requestId,
    details: { status: status || "complete" },
  });

  return NextResponse.json({ ok: true });
}
