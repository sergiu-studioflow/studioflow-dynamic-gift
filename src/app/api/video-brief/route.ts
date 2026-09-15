import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { startTextWorkflow, TEXT_WORKFLOW_PATHS } from "@/app/api/webhook/_lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

/** GET /api/video-brief?clientId= — the selected brand's requests (requests store the brand
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
    .from(schema.videoBriefRequests)
    .where(brandName ? eq(schema.videoBriefRequests.brand, brandName) : undefined)
    .orderBy(desc(schema.videoBriefRequests.createdAt));

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

  let saved = record;
  const startError = await startTextWorkflow(TEXT_WORKFLOW_PATHS.videoBrief, record.id);
  if (startError) {
    [saved] = await db
      .update(schema.videoBriefRequests)
      .set({ status: "error", errorMessage: startError, updatedAt: new Date() })
      .where(eq(schema.videoBriefRequests.id, record.id))
      .returning();
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "video_brief_request_created",
    resourceType: "video_brief_request",
    resourceId: record.id,
    details: { brand: record.brand, contentType: record.contentType, started: !startError },
  });

  return NextResponse.json(saved, { status: 201 });
}
