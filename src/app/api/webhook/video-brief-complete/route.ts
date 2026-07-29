import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { enqueueTextBatch } from "@/lib/qc/enqueue";
import { resolveTextClientId } from "@/lib/qc/grade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { requestId, status } = body;

  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  // The n8n workflow writes briefs directly to Neon, so unlike the other two systems there
  // is nothing to insert here — we read back what it wrote in order to gate it.
  const briefs = await db
    .select({
      id: schema.generatedVideoBriefs.id,
      briefTitle: schema.generatedVideoBriefs.briefTitle,
      primaryHook: schema.generatedVideoBriefs.primaryHook,
    })
    .from(schema.generatedVideoBriefs)
    .where(
      and(
        eq(schema.generatedVideoBriefs.requestId, requestId),
        // Only ungraded rows — a redelivered webhook must not re-queue settled work.
        eq(schema.generatedVideoBriefs.qcStatus, "pending")
      )
    );

  const [reqRow] = await db
    .select({ brand: schema.videoBriefRequests.brand })
    .from(schema.videoBriefRequests)
    .where(eq(schema.videoBriefRequests.id, requestId))
    .limit(1);

  // Quality Control gate — one review per brief.
  await enqueueTextBatch(
    "video_brief",
    briefs.map((b) => ({
      id: b.id,
      copyText: [b.briefTitle, b.primaryHook].filter(Boolean).join(" · ") || null,
    })),
    await resolveTextClientId(reqRow?.brand)
  );

  await db.insert(schema.activityLog).values({
    action: "video_brief_complete",
    resourceType: "video_brief_request",
    resourceId: requestId,
    details: { status: status || "complete", briefCount: briefs.length },
  });

  return NextResponse.json({ ok: true, queuedForQc: briefs.length });
}
