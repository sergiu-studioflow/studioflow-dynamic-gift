import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

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

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const requests = await db
    .select()
    .from(schema.ideationRequests)
    .orderBy(desc(schema.ideationRequests.createdAt));

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
    .select({ name: schema.brands.name })
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

  const webhookBase =
    process.env.N8N_WEBHOOK_BASE || "https://studio-flow.app.n8n.cloud";
  const webhookUrl = `${webhookBase}/webhook/generate-dynamic-gift-ideation?requestId=${record.id}`;

  fetch(webhookUrl, { method: "GET" }).catch((err) => {
    console.error("Failed to trigger n8n webhook:", err);
  });

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ideation_request_created",
    resourceType: "ideation_request",
    resourceId: record.id,
    details: { brand: record.brand, numberOfIdeas: record.numberOfIdeas },
  });

  return NextResponse.json(record, { status: 201 });
}
