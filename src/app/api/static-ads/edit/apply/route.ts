import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateEditCommand, buildEditPrompt, NoApplicableEditsError } from "@/lib/static-ads/edit-pipeline";
import { submitKieJob } from "@/lib/static-ads/kie-ai";

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

    // Build Kie AI prompt from edit command. Throws NoApplicableEditsError — before any row
    // or paid job exists — when every requested change was blocked or unmatched.
    const prompt = buildEditPrompt(editCommandJson);

    // Insert new generation record for the edit
    const [editGeneration] = await db
      .insert(schema.staticAdGenerations)
      .values({
        userId: portalUser.id,
        // Inherit the source ad's client. Without this an edited ad has no
        // clientId at all: it falls out of every gallery/client filter and out
        // of QC's per-client grounding.
        clientId: original.clientId,
        productId: original.productId,
        productName: original.productName,
        styleName: "Edit",
        finalPrompt: prompt,
        aspectRatio: original.aspectRatio,
        resolution: "2K",
        outputFormat: "PNG",
        status: "pending",
        mode: "edit",
        referenceImageUrl: original.imageUrl,
        analysisJson: editCommandJson,
      })
      .returning();

    // Pass the raw public R2 URL to Kie — NOT a presigned URL. Presigned
    // URLs expire after 10 min; if Kie's queue takes longer, the input fetch
    // 403s. The public r2.dev URL doesn't expire.
    let kieResult: Awaited<ReturnType<typeof submitKieJob>>;
    try {
      kieResult = await submitKieJob({
        prompt,
        imageUrls: [original.imageUrl],
        aspectRatio: original.aspectRatio || "1:1",
      });
    } catch (submitErr) {
      // Don't leave an orphan `pending` edit row behind a failed submission.
      const message = submitErr instanceof Error ? submitErr.message : "Image engine submission failed";
      await db
        .update(schema.staticAdGenerations)
        .set({ status: "error", errorMessage: message, updatedAt: new Date() })
        .where(eq(schema.staticAdGenerations.id, editGeneration.id));
      console.error("[static-ads/edit/apply] Kie submit failed:", submitErr);
      return NextResponse.json(
        { error: `Image engine submission failed: ${message}`, generationId: editGeneration.id },
        { status: 502 }
      );
    }

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
    if (err instanceof NoApplicableEditsError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[static-ads/edit/apply]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Edit failed" },
      { status: 500 }
    );
  }
}
