import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

const updateStatusSchema = z.object({
  status: z.enum(["new", "approved", "rejected", "saved"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateStatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid status", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select()
    .from(schema.generatedAdCopy)
    .where(eq(schema.generatedAdCopy.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  }

  const [updated] = await db
    .update(schema.generatedAdCopy)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(schema.generatedAdCopy.id, id))
    .returning();

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "ad_copy_concept_status_updated",
    resourceType: "generated_ad_copy",
    resourceId: id,
    details: { newStatus: parsed.data.status },
  });

  return NextResponse.json(updated);
}
