// The rubric. Pure functions, no I/O.
//
// Hardened against the #1 fleet failure mode — judges are wildly over-strict by default
// (DNA Matt-Bot + onelife-forge lessons). All seven rules are load-bearing; do not
// paraphrase them away:
//   1. PASS-FIRST principle stated up front, twice.
//   2. CLOSED fail lists — only the named conditions may produce a "fail" verdict.
//   3. Ternary verdicts (pass|fail|na) — no numeric scores for the model to drift on.
//   4. overall_pass recomputed IN CODE from the structured verdicts; the model never
//      emits an overall verdict at all.
//   5. Unknown/missing verdicts clamp to "pass" (absence never fails).
//   6. A "WHAT IS NOT A DEFECT" list neutralises the known false-positive patterns.
//   7. Advisory notes are a separate channel that can never change the verdict.
// A deterministic banned-phrase substring scan can only TIGHTEN the verdict (forces
// brand_fit to fail); the code-graded technical criterion is injected as-is.

import { criteriaFor, judgeCriteriaFor, type CriterionKey, type Lane } from "./constants";
import type { BrandGrounding, ProductGrounding } from "./grounding";
import type { TechnicalResult } from "./technical";

export type Verdict = { verdict?: string; note?: string };
export type JudgeVerdicts = {
  criteria?: Partial<Record<CriterionKey, Verdict>>;
  on_asset_text?: string;
  advisory_notes?: string[];
};

export type Criterion = {
  key: string;
  label: string;
  score: number;
  pass: boolean;
  note: string;
  assessed: boolean;
  gating: boolean;
};

// ---------------------------------------------------------------------------
// Shared blocks — identical wording across the visual and text lanes so a client's
// standard means the same thing whichever kind of piece is being graded.
// ---------------------------------------------------------------------------

const PASS_FIRST = `PASS-FIRST PRINCIPLE (read this twice): Default every verdict to "pass". A criterion may be "fail" ONLY when one of its listed closed fail conditions is concretely present — name it in the note. If none applies, the verdict is "pass" even if you have style opinions. Do not hunt for reasons to fail. Hedged observations ("could", "feels", "may read as", "slightly") NEVER justify a fail — put them in advisory_notes instead. "na" means the criterion does not apply to this piece at all.`;

function groundingBlock(g: BrandGrounding): string {
  const out: string[] = [];
  if (g.visualRules.length) out.push(`BRAND RULES:\n${g.visualRules.map((r) => `- ${r}`).join("\n")}`);
  if (g.productFacts.length) out.push(`PRODUCT FACTS:\n${g.productFacts.map((r) => `- ${r}`).join("\n")}`);
  if (g.brandSafetyNotes) out.push(`HOUSE STYLE & ADVISORY CONTEXT (advisory unless it names a closed fail condition):\n${g.brandSafetyNotes}`);
  return out.join("\n\n");
}

function winnerBlock(g: BrandGrounding): string {
  if (!g.winnerProfile) {
    return `PAST WINNERS: no winner profile exists for this brand yet, so winner_alignment is "na". Do not guess at what has worked.`;
  }
  return `PAST WINNERS — what this brand's best-performing creatives have in common:\n${g.winnerProfile}\n\nThis is a REFERENCE, not a template. Departing from it is a business signal worth noting, never a defect. winner_alignment is advisory and does not block anything.`;
}

/** The shared closed fail lists for the three criteria that span both lanes. */
function sharedFailLists(g: BrandGrounding, lane: Lane): string[] {
  const paletteClause = g.paletteHexes.length ? ` (${g.paletteHexes.join(" / ")})` : "";
  const marketClause = g.primaryMarket ? ` The target market is ${g.primaryMarket}.` : "";
  const surface = lane === "visual" ? "creative" : "copy";

  return [
    `- value_clarity — FAIL ONLY on: no discernible offer, benefit, product or hook anywhere in the ${surface}; the dominant message is generic filler carrying no proposition ("Quality you can trust", "Welcome", "The best choice"); ${lane === "visual" ? "the primary message is illegible at thumbnail scale" : "the concept is so abstract that a reader could not say what is being sold or why"}. Minimalism, no price, and no CTA are NOT fail conditions. A hook you personally find weak is NOT a fail condition.`,

    `- copy_direction — FAIL ONLY on: copy that is incoherent or word-salad; copy that contradicts itself or contradicts the product it describes; copy with no discernible angle AND no next step; placeholder or lorem text left in; obviously unfinished text (truncated mid-sentence, stray template tokens like {{name}}). Tone preference, copy length, and a CTA you would have phrased differently are NEVER fail conditions.`,

    `- brand_fit — FAIL ONLY on: ${lane === "visual" ? `ad-design furniture (background, headline, badge, CTA) in a colour clearly foreign to the brand palette${paletteClause}; ` : ""}the brand name misspelled anywhere; a wrong or invented CTA domain; copy in the wrong language for the target market;${marketClause} a stated BRAND RULE above concretely and visibly violated. ${lane === "visual" ? "Tonal variance from lighting or gradients within the palette = pass. Product-layer colours are exempt from the palette rule (two-layer firewall). " : ""}A stylistic choice that merely differs from house style is NOT a fail.`,

    `- winner_alignment — ADVISORY ONLY, never blocks. "pass" when the ${surface} broadly shares the documented winner patterns; "fail" when it clearly diverges on most of them (say which); "na" when no winner profile was supplied. Do not fail this because the piece is new, different, or experimental — note it and move on.`,
  ];
}

const NOT_A_DEFECT_SHARED =
  "lighting choice, camera angle, product scale, styling or arrangement, crop/framing/headroom preferences, \"busy\" or \"cluttered\" layouts, missing CTA or missing price, plain backgrounds, minimalism, tone or register you would have written differently, copy length, and any hedged suspicion you cannot point at concretely";

/** Generate the exact JSON shape the judge must return, from CRITERIA. */
function outputSchema(lane: Lane, isVideo: boolean, includeOnAssetText: boolean): string {
  const keys = judgeCriteriaFor(lane, isVideo).map((c) => c.key);
  const shape = keys.map((k) => `"${k}":{"verdict":"pass|fail|na","note":"..."}`).join(",");
  const extra = includeOnAssetText ? `,"on_asset_text":"..."` : "";
  return `Return ONLY JSON, exactly this shape:\n{"criteria":{${shape}}${extra},"advisory_notes":["..."]}`;
}

// ---------------------------------------------------------------------------
// VISUAL lane
// ---------------------------------------------------------------------------

export function buildVisionSystem(
  g: BrandGrounding,
  product: ProductGrounding,
  ctx: { isVideo: boolean; aspectRatio: string | null; refCount: number }
): string {
  const { isVideo, aspectRatio, refCount } = ctx;
  const is916 = aspectRatio === "9:16";
  const out: string[] = [];

  out.push(
    `You are the automated Quality Control Filter for "${g.brandName}"${g.category ? `, a ${g.category} brand` : ""}. You are a first-pass DEFECT-CATCHER for an AI-generated paid-social ${isVideo ? "VIDEO ad" : "STATIC ad image"} — not an art director. Subjective taste is not your job.`
  );
  out.push(PASS_FIRST);

  if (isVideo) {
    out.push(
      `WATCH THE WHOLE CLIP FIRST and listen to the FULL audio track. Read every piece of on-screen text across all frames. Note whether anyone speaks to camera. THEN decide.`
    );
  }

  // Ground truth
  if (refCount > 0) {
    const idLine = [product.productName, product.category ? `category: ${product.category}` : null]
      .filter(Boolean)
      .join(" · ");
    out.push(
      `REAL PRODUCT PHOTOS (ground truth): the first ${refCount === 1 ? "attached image is" : `${refCount} attached images are`} the brand's REAL photo${refCount === 1 ? "" : "s"} of the product${idLine ? ` (${idLine})` : ""}. The LAST attachment is the generated creative you are grading. The product in the creative must match these photos: colourway, shape, materials, printed marks and lettering.`
    );
  } else {
    out.push(
      `NO REFERENCE PHOTOS ATTACHED for this creative. Judge product INTEGRITY only (warping, melting, distorted or garbled printing, impossible materials) — never fail on colourway-vs-catalogue, since you have no catalogue ground truth here.`
    );
  }

  out.push(
    `TWO-LAYER FIREWALL: the AD-DESIGN layer (backgrounds, headlines, badges, CTA furniture) uses ONLY the brand palette${g.paletteHexes.length ? ` (${g.paletteHexes.join(" / ")})` : ""}; the PRODUCT layer (the product itself) is NEVER recoloured, never re-typeset, its logos never redrawn — it must look exactly as photographed. Product colours are exempt from the palette rule; ad furniture is not.`
  );

  const grounding = groundingBlock(g);
  if (grounding) out.push(grounding);
  out.push(winnerBlock(g));

  out.push(
    `MANDATORY DEFECT SCAN before deciding: read every piece of rendered text glyph-by-glyph; check hands, fingers and faces; check product edges, seams and printed marks${refCount > 0 ? " against the reference photos" : ""};${isVideo ? " watch for objects morphing or warping mid-clip; when someone speaks on camera, check mouth movement against the audio;" : ""} check whether critical text or logos sit in platform UI zones.`
  );

  out.push(`CRITERIA — each verdict is "pass", "fail" or "na". A criterion may FAIL ONLY on its listed conditions:`);

  out.push(
    `- product_fidelity — FAIL ONLY on: ${refCount > 0 ? "product colourway or material clearly different from the reference photos; " : ""}warped, melted or impossible product geometry; a printed logo, mark or lettering that is distorted, misspelled, garbled or redrawn; invented branding on the product. Lighting, camera angle, product scale, styling, arrangement and background are NEVER fail conditions.`
  );
  out.push(
    `- no_hallucinations — FAIL ONLY on: melted/extra/missing fingers, warped faces, duplicated limbs, impossible geometry or physics, garbled nonsense glyphs anywhere, background objects that morph or make no physical sense${isVideo ? ", artifacts appearing anywhere in the clip" : ""}.`
  );

  for (const line of sharedFailLists(g, "visual")) out.push(line);

  // Layout/safe-zone concerns fold into value_clarity's legibility clause for statics;
  // 9:16 UI strips are called out explicitly because they are a real, checkable defect.
  if (is916) {
    out.push(
      `SAFE ZONES: this creative is 9:16. Logos or critical text inside the platform UI strips (top ~14% or bottom ~20%) count as a value_clarity fail — the viewer cannot read them.`
    );
  }

  if (isVideo) {
    out.push(
      `- lip_sync_audio — FAIL ONLY on: spoken audio clearly out of sync with a visible speaking mouth; audio that is corrupted, garbled, clipping or has dropouts. "na" when nobody speaks on camera (B-roll, music-only edits). Music taste, VO delivery style and pacing are advisory only.`
    );
  }

  out.push(
    `WHAT IS NOT A DEFECT (never fail on these; advisory_notes at most): ${NOT_A_DEFECT_SHARED}${isVideo ? ", music taste, pacing" : ""}, soft shadows or gradients within the palette, and the ethnic or demographic mix of a single asset (that is a portfolio-level concern, never a single-asset failure).`
  );

  out.push(
    `Also transcribe ALL rendered text (${isVideo ? "every frame, plus a verbatim transcript of spoken audio" : "verbatim, including small print"}) into on_asset_text.`
  );

  out.push(outputSchema("visual", isVideo, true));
  return out.join("\n");
}

/** The short user-turn message accompanying the attachments. */
export function buildVisionPrompt(ctx: { isVideo: boolean; aspectRatio: string | null }): string {
  return `Grade this ${ctx.isVideo ? "video" : "creative"}${ctx.aspectRatio ? ` (declared aspect ratio ${ctx.aspectRatio})` : ""}. Apply the closed fail lists exactly. Return ONLY the JSON described.`;
}

// ---------------------------------------------------------------------------
// TEXT lane — ad copy concepts, video briefs, content ideas.
// ---------------------------------------------------------------------------

export function buildTextSystem(g: BrandGrounding, ctx: { kindLabel: string }): string {
  const out: string[] = [];

  out.push(
    `You are the automated Quality Control Filter for "${g.brandName}"${g.category ? `, a ${g.category} brand` : ""}. You are a first-pass DEFECT-CATCHER for AI-generated ${ctx.kindLabel} — not a copy chief. Subjective taste is not your job.`
  );
  out.push(PASS_FIRST);

  const grounding = groundingBlock(g);
  if (grounding) out.push(grounding);
  out.push(winnerBlock(g));

  out.push(
    `MANDATORY SCAN before deciding: read every field in full; check brand and product names spelling-exact; check for placeholder text, truncation and template tokens; check the language matches the target market.`
  );
  out.push(`CRITERIA — each verdict is "pass", "fail" or "na". A criterion may FAIL ONLY on its listed conditions:`);
  for (const line of sharedFailLists(g, "text")) out.push(line);

  out.push(
    `WHAT IS NOT A DEFECT (never fail on these; advisory_notes at most): ${NOT_A_DEFECT_SHARED}. You are reading text only — never speculate about imagery, layout or production quality you cannot see.`
  );

  out.push(outputSchema("text", false, false));
  return out.join("\n");
}

export function buildTextPrompt(ctx: { kindLabel: string; body: string }): string {
  return `Grade this ${ctx.kindLabel}. Apply the closed fail lists exactly. Return ONLY the JSON described.\n\n--- BEGIN ${ctx.kindLabel.toUpperCase()} ---\n${ctx.body}\n--- END ---`;
}

// ---------------------------------------------------------------------------
// Scorecard assembly
// ---------------------------------------------------------------------------

const VALID_VERDICTS = new Set(["pass", "fail", "na"]);

/** Clamp a raw model verdict: unknown/missing → "pass" (PASS-FIRST — absence never fails). */
function clampVerdict(v: unknown): "pass" | "fail" | "na" {
  const s = String(v ?? "").trim().toLowerCase();
  return VALID_VERDICTS.has(s) ? (s as "pass" | "fail" | "na") : "pass";
}

/**
 * Combine judge verdicts + the code-graded technical result into the scorecard.
 * - overall_pass is recomputed here: every ASSESSED, GATING criterion must not be "fail".
 *   winner_alignment (gating:false) is recorded and shown but can never block.
 * - A deterministic red-line substring hit on the scanned text hard-fails brand_fit.
 * - judgeOk=false (judge unavailable / unparseable) fails every judged criterion with an
 *   explicit "flagged for human review" note — we never silently auto-approve something
 *   we could not actually inspect.
 * - Scores are synthesised (pass→100, fail→0) purely for UI compatibility; the model
 *   never emits a number.
 */
export function buildScorecard(opts: {
  judged: JudgeVerdicts;
  technical: TechnicalResult;
  bannedPhrasings: string[];
  scanText: string;
  lane: Lane;
  isVideo: boolean;
  judgeOk: boolean;
  /** Message shown on every judged criterion when judgeOk is false. */
  unavailableNote?: string;
}): { criteria: Criterion[]; overallPass: boolean; onAssetText: string; advisoryNotes: string[] } {
  const { judged, technical, bannedPhrasings, scanText, lane, isVideo, judgeOk } = opts;
  const unavailableNote = opts.unavailableNote ?? "Automated grading unavailable — flagged for human review.";

  const text = (scanText ?? "").toLowerCase();
  const hardHit = bannedPhrasings
    .map((b) => b.trim().toLowerCase())
    .filter((b) => b.length >= 3) // 3-char floor guards against pathological rules
    .find((b) => text.includes(b));

  const criteria: Criterion[] = criteriaFor(lane, isVideo).map((c) => {
    if (c.by === "code") {
      return {
        key: c.key,
        label: c.label,
        score: technical.pass ? 100 : 0,
        pass: technical.pass,
        note: technical.note,
        assessed: true,
        gating: c.gating,
      };
    }

    if (!judgeOk) {
      // An advisory criterion must not become a blocker just because the judge died,
      // but it should still read as un-assessed rather than silently passing.
      return {
        key: c.key,
        label: c.label,
        score: 0,
        pass: !c.gating,
        note: unavailableNote,
        assessed: true,
        gating: c.gating,
      };
    }

    const raw = judged.criteria?.[c.key as CriterionKey];
    let verdict = clampVerdict(raw?.verdict);
    let note = (raw?.note ?? "").trim();

    // Deterministic red-line floor: a banned-phrase hit forces brand_fit to fail.
    if (c.key === "brand_fit" && hardHit) {
      verdict = "fail";
      note = `Contains a red-line phrasing: "${hardHit}".${note ? ` ${note}` : ""}`;
    }

    return {
      key: c.key,
      label: c.label,
      score: verdict === "fail" ? 0 : 100,
      pass: verdict !== "fail",
      note,
      assessed: verdict !== "na",
      gating: c.gating,
    };
  });

  // THE verdict: only assessed, gating criteria count.
  const overallPass = criteria.filter((c) => c.assessed && c.gating).every((c) => c.pass);
  const advisoryNotes = (judged.advisory_notes ?? []).filter((n) => typeof n === "string" && n.trim()).slice(0, 6);

  // A failing advisory criterion is surfaced as an advisory note so it is visible in the
  // queue without ever having touched the verdict.
  const advisoryFail = criteria.find((c) => !c.gating && c.assessed && !c.pass);
  if (advisoryFail && advisoryFail.note) advisoryNotes.unshift(`${advisoryFail.label}: ${advisoryFail.note}`);

  return { criteria, overallPass, onAssetText: judged.on_asset_text ?? "", advisoryNotes: advisoryNotes.slice(0, 7) };
}
