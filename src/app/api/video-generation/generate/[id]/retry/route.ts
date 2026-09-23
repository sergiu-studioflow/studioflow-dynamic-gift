import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { submitVideoJob, checkVideoBalance } from "@/lib/video-generation/video-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // balance check (≤10 s) + submit (≤60 s)

/**
 * POST /api/video-generation/generate/[id]/retry
 *
 * Re-submit ONLY the render step of a failed generation, with the exact payload the
 * pipeline sent the first time (`provider_input`). The Claude/GPT prompt steps are not
 * re-run, so a provider hiccup costs one render attempt instead of the whole pipeline.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const [generation] = await db
    .select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id));

  if (!generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }
  if (generation.status !== "error") {
    return NextResponse.json({ error: "Only a failed video can be retried" }, { status: 409 });
  }
  const input = generation.providerInput;
  if (!input) {
    return NextResponse.json(
      { error: "This video failed before its prompt was ready, so it has to be generated again from the start." },
      { status: 409 }
    );
  }

  const balanceProblem = await checkVideoBalance(input.duration);
  if (balanceProblem) {
    return NextResponse.json({ error: balanceProblem }, { status: 402 });
  }

  // Claim the row (error → processing, no request id yet) so a double click can't submit two
  // paid renders. Not `pending`: the pipeline abandon clock counts from createdAt and would
  // fail an older row mid-retry; the processing clock counts from this write.
  const [claimed] = await db
    .update(schema.videoGenerations)
    .set({ status: "processing", muapiRequestId: null, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(schema.videoGenerations.id, id), eq(schema.videoGenerations.status, "error")))
    .returning({ id: schema.videoGenerations.id });
  if (!claimed) {
    return NextResponse.json({ error: "This video is already being retried" }, { status: 409 });
  }

  try {
    const { requestId } = await submitVideoJob(input);
    await db
      .update(schema.videoGenerations)
      .set({ muapiRequestId: requestId, status: "processing", updatedAt: new Date() })
      .where(eq(schema.videoGenerations.id, id));
    return NextResponse.json({
      generationId: id,
      muapiRequestId: requestId,
      // So the progress toast names this video, not whatever is selected in the form now.
      productName: generation.productName,
      videoType: generation.videoType,
      arollStyle: generation.arollStyle,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.videoGenerations)
      .set({ status: "error", errorMessage: `Render retry failed: ${detail}`, updatedAt: new Date() })
      .where(eq(schema.videoGenerations.id, id));
    return NextResponse.json({ error: detail, generationId: id, retryable: true }, { status: 500 });
  }
}
