import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, desc, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/research-briefs
 * List research briefs, scoped by clientId.
 * Optional query params: sourceType, mediaType, status, clientId
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(req.url);
  const sourceType = searchParams.get("sourceType");
  const mediaType = searchParams.get("mediaType");
  const status = searchParams.get("status");
  const clientId = searchParams.get("clientId");

  const conditions = [];
  if (clientId) conditions.push(eq(schema.researchBriefs.clientId, clientId));
  if (sourceType) conditions.push(eq(schema.researchBriefs.sourceType, sourceType));
  if (mediaType) conditions.push(eq(schema.researchBriefs.mediaType, mediaType));
  if (status) conditions.push(eq(schema.researchBriefs.status, status));

  const briefs = await db
    .select({
      id: schema.researchBriefs.id,
      clientId: schema.researchBriefs.clientId,
      sourceType: schema.researchBriefs.sourceType,
      sourceId: schema.researchBriefs.sourceId,
      title: schema.researchBriefs.title,
      mediaType: schema.researchBriefs.mediaType,
      creativeFormat: schema.researchBriefs.creativeFormat,
      funnelStage: schema.researchBriefs.funnelStage,
      primaryHook: schema.researchBriefs.primaryHook,
      targetPersona: schema.researchBriefs.targetPersona,
      status: schema.researchBriefs.status,
      aiModel: schema.researchBriefs.aiModel,
      generationDurationMs: schema.researchBriefs.generationDurationMs,
      createdAt: schema.researchBriefs.createdAt,
    })
    .from(schema.researchBriefs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.researchBriefs.createdAt));

  return NextResponse.json(briefs);
}
