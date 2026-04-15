import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

const CONTENT_TYPES = [
  "UGC",
  "B-Roll",
  "Product Demo",
  "Testimonial Compilation",
  "Behind the Scenes",
  "Case Study",
] as const;

const PLATFORMS = ["Facebook", "Instagram", "LinkedIn"] as const;

const TARGET_PERSONAS = [
  "Corporate Marketing/Procurement",
  "Event Organiser",
  "Small Business Owner",
  "Government/Institutional",
] as const;

const FUNNEL_STAGES = ["Awareness", "Consideration", "Decision"] as const;

const DURATIONS = ["15s", "30s", "60s", "90s"] as const;

const HOOK_STYLES = [
  "Question",
  "Statistic",
  "Pattern Interrupt",
  "Emotional",
  "Curiosity Gap",
] as const;

const VALUE_PROP_OPTIONS = [
  "Concierge Service",
  "Speed",
  "Price",
  "Scale",
  "Design",
  "End-to-End",
  "Range",
] as const;

const createRequestSchema = z.object({
  brand: z.string().min(1),
  scenarioDirection: z.string().min(1),
  contentType: z.enum(CONTENT_TYPES).optional(),
  platform: z.enum(PLATFORMS).optional(),
  targetPersona: z.enum(TARGET_PERSONAS).optional(),
  funnelStage: z.enum(FUNNEL_STAGES).optional(),
  duration: z.enum(DURATIONS).optional(),
  hookStyle: z.enum(HOOK_STYLES).optional(),
  valuePropFocus: z.enum(VALUE_PROP_OPTIONS).optional(),
  productFocus: z.string().optional(),
  additionalContext: z.string().optional(),
});

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const requests = await db
    .select()
    .from(schema.videoBriefRequests)
    .orderBy(desc(schema.videoBriefRequests.createdAt));

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
    .insert(schema.videoBriefRequests)
    .values({
      brand: parsed.data.brand,
      scenarioDirection: parsed.data.scenarioDirection,
      contentType: parsed.data.contentType || null,
      platform: parsed.data.platform || null,
      targetPersona: parsed.data.targetPersona || null,
      funnelStage: parsed.data.funnelStage || null,
      duration: parsed.data.duration || null,
      hookStyle: parsed.data.hookStyle || null,
      valuePropFocus: parsed.data.valuePropFocus || null,
      productFocus: parsed.data.productFocus || null,
      additionalContext: parsed.data.additionalContext || null,
    })
    .returning();

  const webhookBase =
    process.env.N8N_WEBHOOK_BASE || "https://studio-flow.app.n8n.cloud";
  const webhookUrl = `${webhookBase}/webhook/generate-dynamic-gift-video-brief?requestId=${record.id}`;

  fetch(webhookUrl, { method: "GET" }).catch((err) => {
    console.error("Failed to trigger n8n webhook:", err);
  });

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "video_brief_request_created",
    resourceType: "video_brief_request",
    resourceId: record.id,
    details: { brand: record.brand, contentType: record.contentType },
  });

  return NextResponse.json(record, { status: 201 });
}
