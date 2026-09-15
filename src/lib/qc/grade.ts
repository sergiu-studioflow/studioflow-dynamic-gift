// Run the QC scorecard for one gate review.
//
// Visual lane: deterministic technical check (code) + a single judge grade with the
// client's product photo attached as ground truth.
// Text lane:   a single judge grade over the assembled copy body — no asset, no technical.
//
// Grounding is resolved per-client from the review's client_id. The three TEXT tables carry
// no client_id of their own (they predate the multi-client refactor and link to a
// *_requests parent whose `brand` column holds brands.brand_name), so the text lane
// resolves the client by exact brand-name match — see resolveTextClientId.

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { parseJsonLoose, isTransient } from "./claude";
import { fetchAsset, judgeVisual, judgeText } from "./provider";
import { laneFor, type SourceSystem } from "./constants";
import { buildBrandGrounding, productGrounding, type BrandGrounding, type ProductGrounding } from "./grounding";
import { checkImageTechnical, checkVideoTechnical, type TechnicalResult } from "./technical";
import {
  buildVisionSystem,
  buildVisionPrompt,
  buildTextSystem,
  buildTextPrompt,
  buildScorecard,
  type JudgeVerdicts,
  type Criterion,
} from "./prompts";
import { ensureWinnerProfile } from "./winners";

type ReviewRow = typeof schema.gateReviews.$inferSelect;

export type GradeResult = {
  criteria: Criterion[];
  overallPass: boolean;
  onAssetText: string;
  advisoryNotes: string[];
  groundingSource: "flat" | "none";
  rulesetVersion: number | null;
  costCents: number;
};

type SourceContext = {
  productId: string | null;
  aspectRatio: string | null;
  resolution: string | null;
  mode: string | null;
};

const EMPTY_CTX: SourceContext = { productId: null, aspectRatio: null, resolution: null, mode: null };

async function loadSourceContext(review: ReviewRow): Promise<SourceContext> {
  if (!review.sourceId) return EMPTY_CTX;

  if (review.sourceSystem === "static") {
    const [row] = await db
      .select({
        productId: schema.staticAdGenerations.productId,
        aspectRatio: schema.staticAdGenerations.aspectRatio,
        resolution: schema.staticAdGenerations.resolution,
        mode: schema.staticAdGenerations.mode,
      })
      .from(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.id, review.sourceId))
      .limit(1);
    return row ?? EMPTY_CTX;
  }

  // video_generations has no `mode` column — videoType plays that role.
  const [row] = await db
    .select({
      productId: schema.videoGenerations.productId,
      aspectRatio: schema.videoGenerations.aspectRatio,
      videoType: schema.videoGenerations.videoType,
    })
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, review.sourceId))
    .limit(1);
  return row ? { productId: row.productId, aspectRatio: row.aspectRatio, resolution: null, mode: row.videoType } : EMPTY_CTX;
}

// ---------------------------------------------------------------------------
// Text lane
// ---------------------------------------------------------------------------

const TEXT_KIND_LABELS: Record<string, string> = {
  ad_copy: "ad copy concept",
  video_brief: "video brief & script",
  ideation: "content idea",
};

/**
 * Render a stored value into plain text for the judge.
 *
 * The n8n-written jsonb columns are NOT flat string arrays — headlines, descriptions and
 * hook_lines are arrays of objects like {text, char_count} / {text, length_variant}.
 * Naive String() on those yields "[object Object]", which the judge (correctly) reads as
 * broken template output and fails — i.e. it would flag every concept in the portal.
 * So: unwrap the common text-bearing keys, and only fall back to JSON for genuinely
 * unrecognised shapes.
 */
const TEXT_KEYS = ["text", "headline", "value", "label", "hook", "content"];

export function renderValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(renderValue).filter(Boolean).join(" | ");
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      if (typeof obj[key] === "string" && obj[key]) return String(obj[key]);
    }
    return JSON.stringify(v);
  }
  return String(v);
}

const j = renderValue;

/** Render a text row into a flat, labelled body for the judge (and the red-line scan). */
function fieldsToBody(fields: Array<[string, unknown]>): string {
  return fields
    .map(([label, value]) => [label, j(value).trim()] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export type TextPayload = { body: string; clientId: string | null };

// One body per text table — what the judge grades and what a reviewer reads in the QC queue.
function adCopyBody(c: typeof schema.generatedAdCopy.$inferSelect): string {
  return fieldsToBody([
    ["Concept", c.conceptName],
    ["Strategy", c.conceptStrategy],
    ["Angles", c.anglesUsed],
    ["Primary text (short)", c.primaryTextShort],
    ["Primary text (medium)", c.primaryTextMedium],
    ["Primary text (long)", c.primaryTextLong],
    ["Headlines", c.headlines],
    ["Descriptions", c.descriptions],
    ["Hooks", c.hookLines],
    ["CTA", c.ctaRecommendation],
  ]);
}

function videoBriefBody(b: typeof schema.generatedVideoBriefs.$inferSelect): string {
  return fieldsToBody([
    ["Title", b.briefTitle],
    ["Strategic hypothesis", b.strategicHypothesis],
    ["Psychology angle", b.psychologyAngle],
    ["Persona", b.targetPersona],
    ["Funnel stage", b.funnelStage],
    ["Primary hook", b.primaryHook],
    ["Hook variations", b.hookVariations],
    ["Full script", b.fullScript],
    ["Scene breakdown", b.sceneBreakdown],
    ["On-screen text", b.onScreenText],
    ["Visual direction", b.visualDirection],
    ["Brand voice lock", b.brandVoiceLock],
    ["Value prop focus", b.valuePropFocus],
  ]);
}

function ideaBody(i: typeof schema.contentIdeas.$inferSelect): string {
  return fieldsToBody([
    ["Hook", i.hook],
    ["Content type", i.contentType],
    ["Suggested angle", i.suggestedAngle],
    ["Visual direction", i.visualDirection],
    ["Platform", i.platformRecommendation],
    ["Core value props", i.coreValueProps],
    ["Copy direction", i.copyDirection],
  ]);
}

/**
 * Load a text row's gradable body + resolve its client.
 * Returns body:"" when the row is gone (the pipeline then records an honest failure
 * rather than grading an empty string).
 */
export async function loadTextPayload(sourceSystem: SourceSystem, sourceId: string): Promise<TextPayload> {
  const none: TextPayload = { body: "", clientId: null };

  if (sourceSystem === "ad_copy") {
    const [row] = await db
      .select({ c: schema.generatedAdCopy, brand: schema.adCopyRequests.brand })
      .from(schema.generatedAdCopy)
      .leftJoin(schema.adCopyRequests, eq(schema.generatedAdCopy.requestId, schema.adCopyRequests.id))
      .where(eq(schema.generatedAdCopy.id, sourceId))
      .limit(1);
    if (!row) return none;
    return { clientId: await resolveTextClientId(row.brand), body: adCopyBody(row.c) };
  }

  if (sourceSystem === "video_brief") {
    const [row] = await db
      .select({ b: schema.generatedVideoBriefs, brand: schema.videoBriefRequests.brand })
      .from(schema.generatedVideoBriefs)
      .leftJoin(schema.videoBriefRequests, eq(schema.generatedVideoBriefs.requestId, schema.videoBriefRequests.id))
      .where(eq(schema.generatedVideoBriefs.id, sourceId))
      .limit(1);
    if (!row) return none;
    return { clientId: await resolveTextClientId(row.brand), body: videoBriefBody(row.b) };
  }

  // ideation
  const [row] = await db
    .select({ i: schema.contentIdeas, brand: schema.ideationRequests.brand })
    .from(schema.contentIdeas)
    .leftJoin(schema.ideationRequests, eq(schema.contentIdeas.requestId, schema.ideationRequests.id))
    .where(eq(schema.contentIdeas.id, sourceId))
    .limit(1);
  if (!row) return none;
  return { clientId: await resolveTextClientId(row.brand), body: ideaBody(row.i) };
}

export type TextSource = { requestId: string | null; body: string };

export const textSourceKey = (sourceSystem: string, sourceId: string) => `${sourceSystem}:${sourceId}`;

/**
 * The text a set of text-lane reviews is about, for display in the QC queue — so a reviewer
 * approves or rejects what they can read, not a scorecard alone. One query per text table.
 * Keyed by textSourceKey(); rows that no longer exist are simply absent.
 */
export async function loadTextSources(
  reviews: Array<{ sourceSystem: string; sourceId: string | null }>
): Promise<Map<string, TextSource>> {
  const idsFor = (system: SourceSystem) =>
    [...new Set(reviews.filter((r) => r.sourceSystem === system && r.sourceId).map((r) => r.sourceId as string))];
  const out = new Map<string, TextSource>();

  const adCopyIds = idsFor("ad_copy");
  const briefIds = idsFor("video_brief");
  const ideaIds = idsFor("ideation");

  const [adCopy, briefs, ideas] = await Promise.all([
    adCopyIds.length
      ? db.select().from(schema.generatedAdCopy).where(inArray(schema.generatedAdCopy.id, adCopyIds))
      : Promise.resolve([]),
    briefIds.length
      ? db.select().from(schema.generatedVideoBriefs).where(inArray(schema.generatedVideoBriefs.id, briefIds))
      : Promise.resolve([]),
    ideaIds.length
      ? db.select().from(schema.contentIdeas).where(inArray(schema.contentIdeas.id, ideaIds))
      : Promise.resolve([]),
  ]);

  for (const c of adCopy) out.set(textSourceKey("ad_copy", c.id), { requestId: c.requestId, body: adCopyBody(c) });
  for (const b of briefs) out.set(textSourceKey("video_brief", b.id), { requestId: b.requestId, body: videoBriefBody(b) });
  for (const i of ideas) out.set(textSourceKey("ideation", i.id), { requestId: i.requestId, body: ideaBody(i) });
  return out;
}

// brands.brand_name is unique and the three request routes validate `brand` against it
// before insert, so an exact match is reliable. Cached for the process lifetime of a
// batch — brand names effectively never change.
const brandIdCache = new Map<string, string | null>();

export async function resolveTextClientId(brandName: string | null | undefined): Promise<string | null> {
  const name = (brandName ?? "").trim();
  if (!name) return null;
  if (brandIdCache.has(name)) return brandIdCache.get(name) ?? null;

  const [row] = await db
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.brandName, name))
    .limit(1);
  const id = row?.id ?? null;
  if (!id) console.warn(`[qc/grade] no brand matches "${name}" — grading without client grounding`);
  brandIdCache.set(name, id);
  return id;
}

// ---------------------------------------------------------------------------

export async function runGateReview(
  review: ReviewRow,
  groundingCache?: Map<string | null, BrandGrounding>
): Promise<GradeResult> {
  const sourceSystem = review.sourceSystem as SourceSystem;
  const lane = laneFor(sourceSystem);
  const isVideo = sourceSystem === "video";

  // Text rows have no client_id of their own; resolve it before grounding.
  let clientId = review.clientId;
  let textBody = "";
  if (lane === "text" && review.sourceId) {
    const payload = await loadTextPayload(sourceSystem, review.sourceId);
    textBody = payload.body;
    clientId = clientId ?? payload.clientId;
  }

  // Batch callers pass a per-invocation cache so same-client reviews reuse one
  // buildBrandGrounding result.
  let grounding = groundingCache?.get(clientId ?? null);
  if (!grounding) {
    grounding = await buildBrandGrounding(clientId);
    groundingCache?.set(clientId ?? null, grounding);
  }
  // Lazily build the past-winners profile on first use. Never throws; a null profile
  // just means winner_alignment comes back "na".
  if (!grounding.winnerProfile) {
    grounding = { ...grounding, winnerProfile: await ensureWinnerProfile(clientId, grounding.winnerProfile) };
    groundingCache?.set(clientId ?? null, grounding);
  }

  let cost = 0;
  let judged: JudgeVerdicts = {};
  let judgeOk = false;
  let technical: TechnicalResult = { pass: true, note: "Not probed." };
  let unavailableNote: string | undefined;

  if (lane === "text") {
    if (!textBody) {
      throw new Error("Source row is missing or has no gradable content");
    }
    const kindLabel = TEXT_KIND_LABELS[sourceSystem] ?? "copy";
    const out = await judgeText({
      system: buildTextSystem(grounding, { kindLabel }),
      prompt: buildTextPrompt({ kindLabel, body: textBody.slice(0, 12_000) }),
    });
    if (!out.available) {
      unavailableNote =
        "No judge is configured — add an Anthropic or Gemini key in Settings → API Keys. Flagged for human review.";
    } else {
      cost += out.costCents;
      judged = parseJsonLoose<JudgeVerdicts>(out.text);
      judgeOk = !!judged.criteria && typeof judged.criteria === "object" && Object.keys(judged.criteria).length > 0;
      if (!judgeOk) {
        // Almost always a truncated response (thinking tokens ate the output budget).
        // Log it — otherwise this is indistinguishable from "no judge configured".
        console.warn(`[qc] ${out.provider} returned unparseable JSON (${out.text.length} chars): ${out.text.slice(0, 200)}`);
        unavailableNote = "The automated grade came back unreadable — flagged for human review.";
      }
    }
  } else {
    const source = await loadSourceContext(review);
    const product: ProductGrounding = await productGrounding(source);

    if (review.assetPath) {
      // ── Deterministic technical check (code) ──
      let prefetched: { buffer: Buffer; contentType: string } | undefined;
      try {
        prefetched = await fetchAsset(review.assetPath);
        technical = isVideo
          ? checkVideoTechnical(prefetched.buffer, prefetched.contentType)
          : await checkImageTechnical(prefetched.buffer, source);
      } catch (e) {
        // Asset unreachable — retryable infra hiccups bubble up; a permanently
        // missing asset is itself a technical failure.
        if (isTransient(e)) throw e;
        technical = {
          pass: false,
          note: `Asset could not be downloaded: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
        };
      }

      // ── Judge grade ── (skipped on a corrupt file: no point spending a call)
      if (technical.note !== "File could not be decoded as an image.") {
        try {
          const out = await judgeVisual({
            system: buildVisionSystem(grounding, product, {
              isVideo,
              aspectRatio: source.aspectRatio,
              refCount: product.referenceUrls.length,
            }),
            prompt: buildVisionPrompt({ isVideo, aspectRatio: source.aspectRatio }),
            asset: { kind: isVideo ? "video" : "image", url: review.assetPath },
            referenceImages: product.referenceUrls,
            prefetched: isVideo ? prefetched : undefined,
          });
          if (!out.available) {
            unavailableNote = isVideo
              ? "Video grading needs a Gemini key (Claude cannot read video) — add GEMINI_API_KEY in Settings → API Keys. Flagged for human review."
              : "No judge is configured — add an Anthropic or Gemini key in Settings → API Keys. Flagged for human review.";
          } else {
            cost += out.costCents;
            judged = parseJsonLoose<JudgeVerdicts>(out.text);
            judgeOk = !!judged.criteria && typeof judged.criteria === "object" && Object.keys(judged.criteria).length > 0;
            if (!judgeOk) {
              console.warn(`[qc] ${out.provider} returned unparseable JSON (${out.text.length} chars): ${out.text.slice(0, 200)}`);
              unavailableNote = "The automated grade came back unreadable — flagged for human review.";
            }
          }
        } catch (e) {
          // Retryable provider hiccup → bubble up so the pipeline re-queues (no bogus fail).
          if (isTransient(e)) throw e;
          // Permanent failure (e.g. invalid key) → leave judgeOk=false so the scorecard
          // flags it for a human. Never silently auto-approve an un-inspected asset.
          console.warn("[qc] judge failed", String(e).slice(0, 200));
        }
      }
    }
  }

  // The red-line scan covers BOTH the judge's OCR of on-asset text and the stored copy.
  const scanText = `${judged.on_asset_text ?? ""}\n${review.copyText ?? ""}\n${textBody}`;
  const { criteria, overallPass, onAssetText, advisoryNotes } = buildScorecard({
    judged,
    technical,
    bannedPhrasings: grounding.bannedPhrasings,
    scanText,
    lane,
    isVideo,
    judgeOk,
    unavailableNote,
  });

  return {
    criteria,
    overallPass,
    onAssetText,
    advisoryNotes,
    groundingSource: grounding.source,
    rulesetVersion: grounding.version,
    costCents: cost,
  };
}

export type { ReviewRow };
