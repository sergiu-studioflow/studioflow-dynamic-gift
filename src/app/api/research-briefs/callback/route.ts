import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = new Set(["video", "static", "carousel"]);

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Constant-time comparison; hashing first makes both sides the same length. */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** First present value among keys — the brief may use snake_case or camelCase. */
function pick(obj: Obj, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Text columns only accept strings; flatten whatever the model returned. */
function toText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(toText).filter((s): s is string => !!s);
    return parts.length ? parts.join("\n") : null;
  }
  return JSON.stringify(v);
}

/**
 * POST /api/research-briefs/callback
 * Called by n8n when brief generation completes. Public route (no session) —
 * authenticated by the `x-webhook-secret` header, which must equal WEBHOOK_SECRET.
 * Body: { briefId, success, brief, model, durationMs, error }
 * Only a brief that is still `generating` can be written.
 */
export async function POST(req: NextRequest) {
  const expected = (process.env.WEBHOOK_SECRET || "").trim();
  if (!expected) {
    console.error("[research-briefs/callback] WEBHOOK_SECRET is not set — rejecting callback");
    return NextResponse.json({ error: "Callback authentication is not configured" }, { status: 500 });
  }
  if (!secretMatches((req.headers.get("x-webhook-secret") || "").trim(), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isObj(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  const { briefId, success, model, durationMs, error } = body;
  if (typeof briefId !== "string" || !UUID_RE.test(briefId)) {
    return NextResponse.json({ error: "briefId is required" }, { status: 400 });
  }

  const [existing] = await db
    .select({ status: schema.researchBriefs.status, mediaType: schema.researchBriefs.mediaType })
    .from(schema.researchBriefs)
    .where(eq(schema.researchBriefs.id, briefId))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }
  // A finished or failed brief can't be overwritten by a replayed or late callback.
  if (existing.status !== "generating") {
    return NextResponse.json(
      { error: `Brief is not awaiting generation (status: ${existing.status})` },
      { status: 409 }
    );
  }

  // n8n may deliver the brief as a JSON string.
  let brief: unknown = body.brief;
  if (typeof brief === "string") {
    try {
      brief = JSON.parse(brief);
    } catch {
      brief = null;
    }
  }

  // Conditional on status so two concurrent callbacks can't both write.
  const stillGenerating = and(
    eq(schema.researchBriefs.id, briefId),
    eq(schema.researchBriefs.status, "generating")
  );

  if (!(success === true || success === "true") || !isObj(brief)) {
    const [failed] = await db
      .update(schema.researchBriefs)
      .set({
        status: "error",
        errorMessage: (toText(error) || "AI did not return a valid brief").slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(stillGenerating)
      .returning({ id: schema.researchBriefs.id });
    if (!failed) {
      return NextResponse.json({ error: "Brief is no longer awaiting generation" }, { status: 409 });
    }
    return NextResponse.json({ updated: true, status: "error" });
  }

  const mediaType = toText(pick(brief, "media_type", "mediaType"))?.toLowerCase();
  const duration = Number(durationMs);

  // Update with full brief data
  const [completed] = await db
    .update(schema.researchBriefs)
    .set({
      title: toText(pick(brief, "title")) || "Untitled Brief",
      // Keep the media type set from the source unless the brief names a valid one.
      mediaType: mediaType && MEDIA_TYPES.has(mediaType) ? mediaType : existing.mediaType,
      creativeFormat: toText(pick(brief, "creative_format", "creativeFormat")),
      funnelStage: toText(pick(brief, "funnel_stage", "funnelStage")),
      strategicHypothesis: toText(pick(brief, "strategic_hypothesis", "strategicHypothesis")),
      psychologyAngle: toText(pick(brief, "psychology_angle", "psychologyAngle")),
      primaryHook: toText(pick(brief, "primary_hook", "primaryHook")),
      hookVariations: pick(brief, "hook_variations", "hookVariations") ?? null,
      visualDirection: toText(pick(brief, "visual_direction", "visualDirection")),
      shotList: pick(brief, "shot_list", "shotList") ?? null,
      visualComposition: pick(brief, "visual_composition", "visualComposition") ?? null,
      cardDirections: pick(brief, "card_directions", "cardDirections") ?? null,
      onScreenText: pick(brief, "on_screen_text", "onScreenText") ?? null,
      audioDirection: toText(pick(brief, "audio_direction", "audioDirection")),
      brandVoiceLock: toText(pick(brief, "brand_voice_lock", "brandVoiceLock")),
      complianceRequirements: pick(brief, "compliance_requirements", "complianceRequirements") ?? null,
      targetPersona: toText(pick(brief, "target_persona", "targetPersona")),
      lockedElements: pick(brief, "locked_elements", "lockedElements") ?? null,
      variableElements: pick(brief, "variable_elements", "variableElements") ?? null,
      fullBrief: brief,
      status: "complete",
      aiModel: toText(model),
      generationDurationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(stillGenerating)
    .returning({ id: schema.researchBriefs.id });

  if (!completed) {
    return NextResponse.json({ error: "Brief is no longer awaiting generation" }, { status: 409 });
  }
  return NextResponse.json({ updated: true, status: "complete" });
}
