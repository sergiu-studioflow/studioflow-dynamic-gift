import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/research-briefs/callback
 * PUBLIC route (no auth) — called by n8n when brief generation completes.
 * Body: { briefId, success, brief, model, durationMs, error }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { briefId, success, brief, model, durationMs, error } = body;

  if (!briefId) {
    return NextResponse.json({ error: "briefId is required" }, { status: 400 });
  }

  // Verify brief exists
  const [existing] = await db
    .select({ id: schema.researchBriefs.id })
    .from(schema.researchBriefs)
    .where(eq(schema.researchBriefs.id, briefId))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  if (!success || !brief) {
    await db
      .update(schema.researchBriefs)
      .set({
        status: "error",
        errorMessage: error || "AI did not return a valid brief",
        updatedAt: new Date(),
      })
      .where(eq(schema.researchBriefs.id, briefId));
    return NextResponse.json({ updated: true, status: "error" });
  }

  // Update with full brief data
  await db
    .update(schema.researchBriefs)
    .set({
      title: brief.title || "Untitled Brief",
      mediaType: brief.media_type || "static",
      creativeFormat: brief.creative_format || null,
      funnelStage: brief.funnel_stage || null,
      strategicHypothesis: brief.strategic_hypothesis || null,
      psychologyAngle: brief.psychology_angle || null,
      primaryHook: brief.primary_hook || null,
      hookVariations: brief.hook_variations || null,
      visualDirection: brief.visual_direction || null,
      shotList: brief.shot_list || null,
      visualComposition: brief.visual_composition || null,
      cardDirections: brief.card_directions || null,
      onScreenText: brief.on_screen_text || null,
      audioDirection: brief.audio_direction || null,
      brandVoiceLock: brief.brand_voice_lock || null,
      complianceRequirements: brief.compliance_requirements || null,
      targetPersona: brief.target_persona || null,
      lockedElements: brief.locked_elements || null,
      variableElements: brief.variable_elements || null,
      fullBrief: brief,
      status: "complete",
      aiModel: model || null,
      generationDurationMs: durationMs || null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.researchBriefs.id, briefId));

  return NextResponse.json({ updated: true, status: "complete" });
}
