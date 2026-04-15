import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

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

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const requests = await db
    .select()
    .from(schema.adCopyRequests)
    .orderBy(desc(schema.adCopyRequests.createdAt));

  return NextResponse.json(requests);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

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

  const webhookBase =
    process.env.N8N_WEBHOOK_BASE || "https://studio-flow.app.n8n.cloud";
  const webhookUrl = `${webhookBase}/webhook/generate-dynamic-gift-ad-copy?requestId=${record.id}`;

  fetch(webhookUrl, { method: "GET" }).catch((err) => {
    console.error("Failed to trigger n8n webhook:", err);
  });

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ad_copy_request_created",
    resourceType: "ad_copy_request",
    resourceId: record.id,
    details: { brand: record.brand, objective: record.campaignObjective },
  });

  return NextResponse.json(record, { status: 201 });
}
