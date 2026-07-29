import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { enqueueTextBatch } from "@/lib/qc/enqueue";
import { resolveTextClientId } from "@/lib/qc/grade";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { requestId, ideas } = body;

  if (!requestId || !Array.isArray(ideas)) {
    return NextResponse.json(
      { error: "requestId and ideas array required" },
      { status: 400 }
    );
  }

  const inserted: Array<{ id: string; copyText: string | null }> = [];
  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i];
    const [row] = await db.insert(schema.contentIdeas).values({
      requestId,
      hook: idea.hook || "",
      contentType: idea.content_type || idea.contentType || "Product Features",
      suggestedAngle: idea.suggested_angle || idea.suggestedAngle || "",
      visualDirection: idea.visual_direction || idea.visualDirection || "",
      platformRecommendation:
        idea.platform_recommendation || idea.platformRecommendation || "Facebook",
      coreValueProps: idea.core_value_props || idea.coreValueProps || null,
      copyDirection: idea.copy_direction || idea.copyDirection || null,
      sortOrder: i,
    }).returning({ id: schema.contentIdeas.id });
    if (row) inserted.push({ id: row.id, copyText: idea.hook || null });
  }

  await db
    .update(schema.ideationRequests)
    .set({ status: "complete", updatedAt: new Date() })
    .where(eq(schema.ideationRequests.id, requestId));

  // Quality Control gate — one review per idea. A run emits up to 25, which is why the
  // text lane has its own larger claim budget and runs concurrently (qc/pipeline.ts).
  const [reqRow] = await db
    .select({ brand: schema.ideationRequests.brand })
    .from(schema.ideationRequests)
    .where(eq(schema.ideationRequests.id, requestId))
    .limit(1);
  await enqueueTextBatch("ideation", inserted, await resolveTextClientId(reqRow?.brand));

  await db.insert(schema.activityLog).values({
    action: "ideation_complete",
    resourceType: "ideation_request",
    resourceId: requestId,
    details: { ideaCount: ideas.length },
  });

  return NextResponse.json({ ok: true, ideaCount: ideas.length });
}
