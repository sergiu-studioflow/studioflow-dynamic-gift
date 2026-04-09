import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateEditCommand, buildEditPrompt } from "@/lib/static-ads/edit-pipeline";
import { submitKieJob } from "@/lib/static-ads/kie-ai";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/static-ads/edit/apply
 *
 * Runs Agent 3 (edit command generator) + Kie AI submission.
 * Input: { generationId, analysisJson, edits: [{name, newText}] }
 * Output: { generationId, kieJobId }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  let body: {
    generationId: string;
    analysisJson: string;
    edits: { name: string; newText: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { generationId, analysisJson, edits } = body;

  if (!generationId || !analysisJson || !edits?.length) {
    return NextResponse.json(
      { error: "generationId, analysisJson, and at least one edit are required" },
      { status: 400 }
    );
  }

  // Fetch the original generation
  const [original] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, generationId))
    .limit(1);

  if (!original || !original.imageUrl) {
    return NextResponse.json({ error: "Original generation not found" }, { status: 404 });
  }

  try {
    // Agent 3: Generate structured edit command
    const editCommandJson = await generateEditCommand(analysisJson, edits);

    // Build Kie AI prompt from edit command
    const prompt = buildEditPrompt(editCommandJson);

    // Insert new generation record for the edit
    const [editGeneration] = await db
      .insert(schema.staticAdGenerations)
      .values({
        userId: portalUser.id,
        productId: original.productId,
        productName: original.productName,
        styleName: "Edit",
        finalPrompt: prompt,
        aspectRatio: original.aspectRatio,
        resolution: "1K",
        outputFormat: "PNG",
        status: "pending",
        mode: "edit",
        referenceImageUrl: original.imageUrl,
        analysisJson: editCommandJson,
      })
      .returning();

    // Get presigned URL for the original image (Kie needs to access it)
    const accessibleImageUrl = await toAccessibleUrl(original.imageUrl);

    // Submit to Kie AI with the original image + edit prompt
    const kieResult = await submitKieJob({
      prompt,
      imageUrls: [accessibleImageUrl],
      aspectRatio: original.aspectRatio || "1:1",
    });

    // Update with Kie job ID
    await db
      .update(schema.staticAdGenerations)
      .set({
        kieJobId: kieResult.taskId,
        status: "generating",
        updatedAt: new Date(),
      })
      .where(eq(schema.staticAdGenerations.id, editGeneration.id));

    return NextResponse.json({
      generationId: editGeneration.id,
      kieJobId: kieResult.taskId,
    });
  } catch (err) {
    console.error("[static-ads/edit/apply]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Edit failed" },
      { status: 500 }
    );
  }
}
