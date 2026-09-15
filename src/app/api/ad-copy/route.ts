import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { startTextWorkflow, TEXT_WORKFLOW_PATHS } from "@/app/api/webhook/_lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CAMPAIGN_OBJECTIVES = [
  "Lead Generation",
  "Brand Awareness",
  "Traffic",
  "Engagement",
  "Retargeting",
] as const;

const TARGET_PERSONAS = [
  "Corporate Marketing/Procurement",
  "Event Organiser",
  "Small Business Owner",
  "Government/Institutional",
] as const;

const CORE_ANGLES = [
  "Speed & Turnaround",
  "Full-Service Concierge",
  "Price Competitiveness",
  "Proof Points & Credibility",
  "Objection Handling",
  "100% Bespoke",
] as const;

const AD_FORMATS = ["Single Image", "Carousel", "Video"] as const;

const TONE_VARIATIONS = [
  "Confident Direct",
  "Problem-Solution",
  "Social Proof Heavy",
  "Urgency",
  "Conversational",
] as const;

const createRequestSchema = z.object({
  brand: z.string().min(1),
  campaignObjective: z.enum(CAMPAIGN_OBJECTIVES),
  targetPersona: z.enum(TARGET_PERSONAS),
  productFocus: z.string().optional(),
  angleEmphasis: z.array(z.enum(CORE_ANGLES)).min(1),
  adFormat: z.enum(AD_FORMATS),
  toneVariation: z.enum(TONE_VARIATIONS).optional(),
  numberOfConcepts: z.number().min(1).max(5).optional(),
  additionalContext: z.string().optional(),
});

/** GET /api/ad-copy?clientId= — the selected brand's requests (requests store the brand
 *  NAME); without clientId ("All Clients") every brand's. */
export async function GET(httpReq: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const clientId = httpReq.nextUrl.searchParams.get("clientId");
  let brandName: string | null = null;
  if (clientId) {
    if (!z.guid().safeParse(clientId).success) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }
    const [brand] = await db
      .select({ name: schema.brands.brandName })
      .from(schema.brands)
      .where(eq(schema.brands.id, clientId))
      .limit(1);
    if (!brand) return NextResponse.json([]);
    brandName = brand.name;
  }

  const requests = await db
    .select()
    .from(schema.adCopyRequests)
    .where(brandName ? eq(schema.adCopyRequests.brand, brandName) : undefined)
    .orderBy(desc(schema.adCopyRequests.createdAt));

  return NextResponse.json(requests);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot start generation runs" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.format() },
      { status: 400 }
    );
  }

  // Validate brand exists in DB
  const activeBrands = await db
    .select({ name: schema.brands.brandName })
    .from(schema.brands)
    .where(eq(schema.brands.isActive, true));
  const validBrandNames = activeBrands.map((b) => b.name);
  if (!validBrandNames.includes(parsed.data.brand)) {
    return NextResponse.json(
      { error: `Invalid brand: "${parsed.data.brand}". Available: ${validBrandNames.join(", ")}` },
      { status: 400 }
    );
  }

  const [record] = await db
    .insert(schema.adCopyRequests)
    .values({
      brand: parsed.data.brand,
      campaignObjective: parsed.data.campaignObjective,
      targetPersona: parsed.data.targetPersona,
      productFocus: parsed.data.productFocus || null,
      angleEmphasis: parsed.data.angleEmphasis,
      adFormat: parsed.data.adFormat,
      toneVariation: parsed.data.toneVariation || null,
      numberOfConcepts: parsed.data.numberOfConcepts || 3,
      additionalContext: parsed.data.additionalContext || null,
    })
    .returning();

  let saved = record;
  const startError = await startTextWorkflow(TEXT_WORKFLOW_PATHS.adCopy, record.id);
  if (startError) {
    [saved] = await db
      .update(schema.adCopyRequests)
      .set({ status: "error", errorMessage: startError, updatedAt: new Date() })
      .where(eq(schema.adCopyRequests.id, record.id))
      .returning();
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ad_copy_request_created",
    resourceType: "ad_copy_request",
    resourceId: record.id,
    details: { brand: record.brand, objective: record.campaignObjective, started: !startError },
  });

  return NextResponse.json(saved, { status: 201 });
}
