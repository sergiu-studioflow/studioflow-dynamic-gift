import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

export const dynamic = "force-dynamic";

const updateStatusSchema = z.object({
  status: z.enum(["pending_review", "approved", "rejected", "revision_needed"]),
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
    .from(schema.generatedVideoBriefs)
    .where(eq(schema.generatedVideoBriefs.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  const [updated] = await db
    .update(schema.generatedVideoBriefs)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(schema.generatedVideoBriefs.id, id))
    .returning();

  await db.insert(schema.activityLog).values({
    userId: auth.portalUser.id,
    action: "video_brief_status_updated",
    resourceType: "generated_video_brief",
    resourceId: id,
    details: { newStatus: parsed.data.status },
  });

  return NextResponse.json(updated);
}
