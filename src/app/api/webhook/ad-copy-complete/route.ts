import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { enqueueTextBatch } from "@/lib/qc/enqueue";
import { resolveTextClientId } from "@/lib/qc/grade";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Validate webhook secret
  const secret = request.headers.get("x-webhook-secret");
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { requestId, concepts, error: errorMsg } = body;

  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  if (errorMsg) {
    await db
      .update(schema.adCopyRequests)
      .set({ status: "error", errorMessage: errorMsg, updatedAt: new Date() })
      .where(eq(schema.adCopyRequests.id, requestId));

    await db.insert(schema.activityLog).values({
      action: "ad_copy_error",
      resourceType: "ad_copy_request",
      resourceId: requestId,
      details: { error: errorMsg },
    });

    return NextResponse.json({ ok: true, status: "error" });
  }

  // Insert concepts if provided
  if (concepts && Array.isArray(concepts)) {
    const inserted: Array<{ id: string; copyText: string | null }> = [];
    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i];
      const [row] = await db.insert(schema.generatedAdCopy).values({
        requestId,
        conceptNumber: c.concept_number || i + 1,
        conceptName: c.concept_name || null,
        conceptStrategy: c.concept_strategy || null,
        anglesUsed: c.angles_used || null,
        primaryTextShort: c.primary_text_short || null,
        primaryTextMedium: c.primary_text_medium || null,
        primaryTextLong: c.primary_text_long || null,
        headlines: c.headlines || null,
        descriptions: c.descriptions || null,
        hookLines: c.hook_lines || null,
        ctaRecommendation: c.cta_recommendation || null,
        abTestingNotes: c.ab_testing_notes || null,
        complianceStatus: c.compliance_status || "passed",
        complianceNotes: c.compliance_notes || null,
        sortOrder: i,
      }).returning({ id: schema.generatedAdCopy.id });
      if (row) inserted.push({ id: row.id, copyText: [c.primary_text_medium, c.headlines, c.cta_recommendation].filter(Boolean).join(" ") || null });
    }

    await db
      .update(schema.adCopyRequests)
      .set({ status: "complete", updatedAt: new Date() })
      .where(eq(schema.adCopyRequests.id, requestId));

    // Quality Control gate — one review per concept. Text rows carry no client_id, so
    // the client is resolved from the request's brand name.
    const [reqRow] = await db
      .select({ brand: schema.adCopyRequests.brand })
      .from(schema.adCopyRequests)
      .where(eq(schema.adCopyRequests.id, requestId))
      .limit(1);
    await enqueueTextBatch("ad_copy", inserted, await resolveTextClientId(reqRow?.brand));
  }

  await db.insert(schema.activityLog).values({
    action: "ad_copy_complete",
    resourceType: "ad_copy_request",
    resourceId: requestId,
    details: { conceptCount: concepts?.length || 0 },
  });

  return NextResponse.json({ ok: true });
}
