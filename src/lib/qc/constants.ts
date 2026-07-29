// Quality Control Filter — shared constants. Port of the Pure Path / OLS / HelloHair
// compliance gate, re-tuned for Dynamic Gift (multi-client promotional gifts & merch)
// and extended with a TEXT lane plus a past-winners criterion.
//
// A single vision/text judge grades every generated piece on ternary pass/fail/na
// verdicts against CLOSED fail lists (PASS-FIRST — the fleet lesson is that judges are
// wildly over-strict by default), plus a deterministic technical check graded in code.

export const SYSTEM_KEY = "quality-control";

// ---------------------------------------------------------------------------
// The scorecard. This array is the single source of truth: it drives the judge's
// requested JSON shape, buildScorecard, and the UI. Changing it here flows everywhere.
//
//   by     — how the criterion is graded: "code" (deterministic sharp probe) or "judge".
//   lane   — which asset kinds it applies to: "visual" | "text" | "both".
//   gating — whether a fail blocks the piece. winner_alignment is ADVISORY: recorded and
//            displayed, but deliberately excluded from overallPass. A novel creative that
//            departs from past winners is a business signal, not a defect.
//   videoOnly — omitted for anything that isn't a video.
//
// Maps to the five questions the system was specified to answer:
//   Q1 "Does it immediately convey value?"          → value_clarity
//   Q2 "Is the product imagery sharp and pro?"      → technical + product_fidelity + no_hallucinations
//   Q3 "Does the copy have direction?"              → copy_direction
//   Q4 "Is it on-brand for the specific brand?"     → brand_fit
//   Q5 "Does it match patterns from past winners?"  → winner_alignment (advisory)
// ---------------------------------------------------------------------------
export const CRITERIA = [
  { key: "technical", label: "Resolution & file integrity", by: "code", lane: "visual", gating: true, videoOnly: false },
  { key: "product_fidelity", label: "Product matches its photo", by: "judge", lane: "visual", gating: true, videoOnly: false },
  { key: "no_hallucinations", label: "No AI artifacts", by: "judge", lane: "visual", gating: true, videoOnly: false },
  { key: "value_clarity", label: "Immediately conveys value", by: "judge", lane: "both", gating: true, videoOnly: false },
  { key: "copy_direction", label: "Copy has direction", by: "judge", lane: "both", gating: true, videoOnly: false },
  { key: "brand_fit", label: "On-brand for this client", by: "judge", lane: "both", gating: true, videoOnly: false },
  { key: "winner_alignment", label: "Matches past winners", by: "judge", lane: "both", gating: false, videoOnly: false },
  { key: "lip_sync_audio", label: "Lip sync & audio quality", by: "judge", lane: "visual", gating: true, videoOnly: true },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];
export type Lane = "visual" | "text";

/** Criteria applicable to a given asset. Statics drop lip_sync_audio; the text lane
 *  drops everything that needs pixels. */
export function criteriaFor(lane: Lane, isVideo = false) {
  return CRITERIA.filter((c) => {
    if (c.lane !== "both" && c.lane !== lane) return false;
    if (c.videoOnly && !isVideo) return false;
    return true;
  });
}

/** The criteria the judge is asked to return (everything not graded in code). */
export function judgeCriteriaFor(lane: Lane, isVideo = false) {
  return criteriaFor(lane, isVideo).filter((c) => c.by === "judge");
}

// Fleet memory: gemini-2.5-flash (the donors' pin) is retired and 404s for new keys —
// default to the evergreen alias, overridable per-deploy without a code change.
export const GEMINI_MODEL = (process.env.QC_GEMINI_MODEL || "gemini-flash-latest").trim();
export const MAX_ATTEMPTS = 3;

export const GATE_STATUSES = ["pending", "running", "complete", "failed"] as const;

// qc_status values on the output rows; ('approved','skipped') = shippable.
export const QC_STATUSES = ["pending", "flagged", "approved", "rejected", "skipped"] as const;
export const QC_SHIPPABLE: readonly string[] = ["approved", "skipped"];

// ---------------------------------------------------------------------------
// source_system discriminates which table a gate_review belongs to.
// ---------------------------------------------------------------------------
export const SOURCE_SYSTEMS = ["static", "video", "ad_copy", "video_brief", "ideation"] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const VISUAL_SYSTEMS: readonly SourceSystem[] = ["static", "video"];
export const TEXT_SYSTEMS: readonly SourceSystem[] = ["ad_copy", "video_brief", "ideation"];

export function laneFor(sourceSystem: SourceSystem): Lane {
  return VISUAL_SYSTEMS.includes(sourceSystem) ? "visual" : "text";
}

export const SOURCE_SYSTEM_LABELS: Record<SourceSystem, string> = {
  static: "Static Ads",
  video: "Video Generation",
  ad_copy: "Ad Copy",
  video_brief: "Video Briefs",
  ideation: "Content Ideation",
};

// ---------------------------------------------------------------------------
// Static modes the gate does NOT grade. Deliberately an EXEMPT list rather than an
// allowlist: an allowlist silently stops grading real ads the day someone adds a new
// mode, which is the dangerous failure direction. These two are refined-chain artifacts
// that are already hidden from the gallery and never ship.
// video_generations has no `mode` column, so every completed video is graded.
// ---------------------------------------------------------------------------
export const QC_EXEMPT_STATIC_MODES: readonly string[] = ["intermediate", "logo-refined"];

/** Claim budgets. Visual grades download an asset and call a vision model (slow, ~cents);
 *  text grades are a single small completion (~2s, sub-cent) and Content Ideation emits 25
 *  rows per request, so the text lane gets a much larger budget and runs concurrently. */
export const CLAIM_LIMITS = {
  tick: { visual: 2, text: 12 },
  cron: { visual: 6, text: 25 },
} as const;
export const TEXT_CONCURRENCY = 5;
