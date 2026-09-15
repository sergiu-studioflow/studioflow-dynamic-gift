import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { startTextWorkflow, TEXT_WORKFLOW_PATHS } from "@/app/api/webhook/_lib/n8n";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CONTENT_TYPES = [
  "Review/Testimonial",
  "Product Features",
  "Behind the Scenes",
  "Value Prop Reinforcement",
  "Educational",
  "Case Study",
] as const;

const createRequestSchema = z.object({
  brand: z.string().min(1),
  direction: z.string().min(1),
  contentTypes: z.array(z.enum(CONTENT_TYPES)).min(1),
  numberOfIdeas: z.number().int().min(5).max(30).default(25),
  additionalContext: z.string().optional(),
});

/** GET /api/ideation?clientId= — the selected brand's requests (requests store the brand
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
    .from(schema.ideationRequests)
    .where(brandName ? eq(schema.ideationRequests.brand, brandName) : undefined)
    .orderBy(desc(schema.ideationRequests.createdAt));

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
    .insert(schema.ideationRequests)
    .values({
      brand: parsed.data.brand,
      direction: parsed.data.direction,
      contentTypes: parsed.data.contentTypes,
      numberOfIdeas: parsed.data.numberOfIdeas,
      additionalContext: parsed.data.additionalContext || null,
    })
    .returning();

  let saved = record;
  const startError = await startTextWorkflow(TEXT_WORKFLOW_PATHS.ideation, record.id);
  if (startError) {
    [saved] = await db
      .update(schema.ideationRequests)
      .set({ status: "error", errorMessage: startError, updatedAt: new Date() })
      .where(eq(schema.ideationRequests.id, record.id))
      .returning();
  }

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ideation_request_created",
    resourceType: "ideation_request",
    resourceId: record.id,
    details: { brand: record.brand, numberOfIdeas: record.numberOfIdeas, started: !startError },
  });

  return NextResponse.json(saved, { status: 201 });
}
