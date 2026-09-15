"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Video,
  Image as ImageIcon,
  Layers,
  Clock,
  Loader2,
  AlertCircle,
  Sparkles,
  Lock,
  Unlock,
  Shield,
  Target,
  Brain,
  Eye,
  Volume2,
  Type,
  ChevronDown,
  ChevronUp,
  Trash2,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ResearchBrief } from "@/lib/types";
import { BRIEF_STALE_MS } from "@/components/competitor-ads/use-source-brief";

const mediaTypeIcons: Record<string, typeof Video> = {
  video: Video,
  static: ImageIcon,
  carousel: Layers,
};

const funnelColors: Record<string, string> = {
  TOF: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  MOF: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  BOF: "bg-green-500/10 text-green-500 border-green-500/20",
};

// ── Normalising the n8n brief ────────────────────────────────────────────────
// The brief comes from an LLM via n8n: keys may be snake_case or camelCase,
// lists may arrive as strings, and fields may only exist in full_brief.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** First present value among keys (either casing). */
function pick(obj: Obj | null | undefined, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Render-safe text for any JSON value. */
function toText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(toText).filter((s): s is string => !!s);
    return parts.length ? parts.join("\n") : null;
  }
  if (isObj(v)) {
    const inner = pick(v, "text", "value", "hook", "description", "content");
    return typeof inner === "string" ? inner : JSON.stringify(v);
  }
  return null;
}

/** A list of strings from an array, or from a newline / bullet separated string. */
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(toText).filter((s): s is string => !!s);
  if (typeof v === "string") {
    return v
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
      .filter(Boolean);
  }
  const text = toText(v);
  return text ? [text] : [];
}

/** Object rows from an array (or a single object); anything else comes back as text. */
function toRows(v: unknown): { rows: Obj[]; text: string | null } {
  if (Array.isArray(v)) {
    const rows = v.filter(isObj);
    return { rows, text: toText(v.filter((item) => !isObj(item))) };
  }
  if (isObj(v)) return { rows: [v], text: null };
  return { rows: [], text: toText(v) };
}

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: typeof Brain;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3.5 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="px-5 py-4 space-y-3">{children}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-foreground whitespace-pre-line">{value}</dd>
    </div>
  );
}

export default function BriefDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  // Still "generating" long after it started: the n8n callback never came.
  const [stalled, setStalled] = useState(false);

  const fetchBrief = useCallback(async () => {
    try {
      const res = await fetch(`/api/research-briefs/${params.id}`);
      if (res.ok) {
        const data: ResearchBrief = await res.json();
        setBrief(data);
        setStalled(
          data.status === "generating" && Date.now() - new Date(data.createdAt).getTime() > BRIEF_STALE_MS
        );
      } else if (res.status === 404) {
        setBrief(null);
      }
    } catch {
      // network blip — keep what we have; the next poll retries
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  // Keep checking while n8n is still writing the brief.
  const isGenerating = brief?.status === "generating";
  useEffect(() => {
    if (!isGenerating || stalled) return;
    const interval = setInterval(fetchBrief, 5000);
    return () => clearInterval(interval);
  }, [isGenerating, stalled, fetchBrief]);

  async function handleDelete() {
    if (!confirm("Delete this brief? This cannot be undone.")) return;
    setDeleting(true);
    const res = await fetch(`/api/research-briefs/${params.id}`, { method: "DELETE" });
    if (res.ok) router.push("/research-briefs");
    setDeleting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium">Brief not found</h3>
        <Link href="/research-briefs" className="text-sm text-primary hover:underline mt-2">
          Back to briefs
        </Link>
      </div>
    );
  }

  if (brief.status === "error") {
    return (
      <div className="space-y-6">
        <Link href="/research-briefs" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to briefs
        </Link>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">Brief Generation Failed</h3>
          <p className="text-sm text-muted-foreground">{brief.errorMessage || "Unknown error"}</p>
        </div>
      </div>
    );
  }

  if (brief.status === "generating") {
    return (
      <div className="space-y-6">
        <Link href="/research-briefs" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to briefs
        </Link>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          {stalled ? (
            <AlertCircle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
          )}
          <h3 className="font-semibold text-foreground mb-1">
            {stalled ? "This brief is taking much longer than expected" : "Generating brief…"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {stalled
              ? "The brief generator hasn't reported back in over 30 minutes, so it has most likely failed. Delete this brief and generate it again from the ad or post."
              : "This usually takes a minute or two. This page updates automatically."}
          </p>
          {stalled && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="mt-4 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete brief
            </button>
          )}
        </div>
      </div>
    );
  }

  const full = isObj(brief.fullBrief) ? brief.fullBrief : null;
  // Prefer the stored column; fall back to the raw brief (either key casing).
  const get = (column: unknown, snake: string, camel: string) =>
    column !== null && column !== undefined && column !== "" ? column : pick(full, snake, camel);

  const MediaIcon = mediaTypeIcons[brief.mediaType] || FileText;
  const title = toText(brief.title) || "Untitled Brief";
  const funnelStage = toText(get(brief.funnelStage, "funnel_stage", "funnelStage"));
  const creativeFormat = toText(get(brief.creativeFormat, "creative_format", "creativeFormat"));
  const strategicHypothesis = toText(get(brief.strategicHypothesis, "strategic_hypothesis", "strategicHypothesis"));
  const psychologyAngle = toText(get(brief.psychologyAngle, "psychology_angle", "psychologyAngle"));
  const targetPersona = toText(get(brief.targetPersona, "target_persona", "targetPersona"));
  const primaryHook = toText(get(brief.primaryHook, "primary_hook", "primaryHook"));
  const visualDirection = toText(get(brief.visualDirection, "visual_direction", "visualDirection"));
  const audioDirection = toText(get(brief.audioDirection, "audio_direction", "audioDirection"));
  const brandVoiceLock = toText(get(brief.brandVoiceLock, "brand_voice_lock", "brandVoiceLock"));
  const hookVariations = toList(get(brief.hookVariations, "hook_variations", "hookVariations"));
  const shotList = toRows(get(brief.shotList, "shot_list", "shotList"));
  const visualCompRaw = get(brief.visualComposition, "visual_composition", "visualComposition");
  const visualComp = isObj(visualCompRaw) ? visualCompRaw : null;
  const visualCompText = visualComp ? null : toText(visualCompRaw);
  const cardDirs = toRows(get(brief.cardDirections, "card_directions", "cardDirections"));
  const onScreenText = toRows(get(brief.onScreenText, "on_screen_text", "onScreenText"));
  const complianceReqs = toList(get(brief.complianceRequirements, "compliance_requirements", "complianceRequirements"));
  const lockedEls = toList(get(brief.lockedElements, "locked_elements", "lockedElements"));
  const variableEls = toList(get(brief.variableElements, "variable_elements", "variableElements"));

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/research-briefs"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to briefs
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete
        </button>
      </div>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="rounded-lg bg-muted p-2">
            <MediaIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          {funnelStage && (
            <Badge variant="outline" className={funnelColors[funnelStage] || ""}>
              {funnelStage}
            </Badge>
          )}
          {creativeFormat && (
            <Badge variant="outline">{creativeFormat}</Badge>
          )}
          <Badge variant="outline" className="text-muted-foreground">
            {brief.mediaType}
          </Badge>
        </div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3" />
            {brief.sourceType === "competitor_ad" ? "From Meta Ad" : "From Organic Post"}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(brief.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </span>
          {typeof brief.generationDurationMs === "number" && brief.generationDurationMs > 0 && (
            <span>Generated in {(brief.generationDurationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>

      {/* Strategic Foundation */}
      <Section title="Strategic Foundation" icon={Brain}>
        <Field label="Strategic Hypothesis" value={strategicHypothesis} />
        <Field label="Psychology Angle" value={psychologyAngle} />
        <Field label="Target Persona" value={targetPersona} />
      </Section>

      {/* Hooks */}
      <Section title="Hooks" icon={Sparkles}>
        <Field label="Primary Hook" value={primaryHook} />
        {hookVariations.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Hook Variations
            </dt>
            <ol className="space-y-2">
              {hookVariations.map((hook, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">
                    {i + 1}
                  </span>
                  <span className="text-foreground">{hook}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      {/* Creative Direction (conditional on media type) */}
      <Section title="Creative Direction" icon={Eye}>
        <Field label="Visual Direction" value={visualDirection} />

        {/* Video: Shot List */}
        {shotList.rows.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Shot List
            </dt>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Timecode</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Shot</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">On-Screen Text</th>
                  </tr>
                </thead>
                <tbody>
                  {shotList.rows.map((shot, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-primary whitespace-nowrap">
                        {toText(pick(shot, "timecode", "time_code", "timeCode", "timestamp", "time")) || "—"}
                      </td>
                      <td className="px-3 py-2 font-medium">{toText(pick(shot, "shot", "shot_type", "shotType", "type")) || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{toText(pick(shot, "description", "action", "details"))}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {toText(pick(shot, "on_screen_text", "onScreenText", "text_overlay", "textOverlay")) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Field label="Shot List" value={shotList.text} />

        {/* Static: Visual Composition */}
        {visualComp && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Layout" value={toText(pick(visualComp, "layout"))} />
            <Field label="Color Palette" value={toText(pick(visualComp, "color_palette", "colorPalette", "palette", "colors"))} />
            <Field label="Typography" value={toText(pick(visualComp, "typography", "fonts"))} />
            <Field label="Visual Hierarchy" value={toText(pick(visualComp, "hierarchy", "visual_hierarchy", "visualHierarchy"))} />
          </div>
        )}
        <Field label="Visual Composition" value={visualCompText} />

        {/* Carousel: Card Directions */}
        {cardDirs.rows.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Card-by-Card Direction
            </dt>
            <div className="space-y-3">
              {cardDirs.rows.map((card, i) => (
                <div key={i} className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-primary">
                    Card {toText(pick(card, "card_number", "cardNumber", "card", "number")) || i + 1}
                  </div>
                  <Field label="Angle" value={toText(pick(card, "angle"))} />
                  <Field label="Visual" value={toText(pick(card, "visual", "visual_direction", "visualDirection"))} />
                  <Field label="Copy" value={toText(pick(card, "copy", "text", "headline"))} />
                  <Field label="CTA" value={toText(pick(card, "cta", "call_to_action", "callToAction"))} />
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label="Card-by-Card Direction" value={cardDirs.text} />

        {/* On-Screen Text */}
        {onScreenText.rows.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              On-Screen Text Overlays
            </dt>
            <div className="space-y-2">
              {onScreenText.rows.map((item, i) => {
                const timing = toText(pick(item, "timing", "timecode", "time"));
                const placement = toText(pick(item, "placement", "position"));
                const style = toText(pick(item, "style"));
                return (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <Type className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">&ldquo;{toText(pick(item, "text", "copy")) || "—"}&rdquo;</span>
                      {(timing || placement) && (
                        <span className="text-muted-foreground"> — {[timing, placement].filter(Boolean).join(", ")}</span>
                      )}
                      {style && <span className="text-muted-foreground/60"> ({style})</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <Field label="On-Screen Text Overlays" value={onScreenText.text} />
      </Section>

      {/* Audio & Voice */}
      {(audioDirection || brandVoiceLock) && (
        <Section title="Audio & Voice" icon={Volume2}>
          <Field label="Audio Direction" value={audioDirection} />
          <Field label="Brand Voice Lock" value={brandVoiceLock} />
        </Section>
      )}

      {/* Execution Guide */}
      {(lockedEls.length > 0 || variableEls.length > 0) && (
        <Section title="Execution Guide" icon={Lock}>
          {lockedEls.length > 0 && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Lock className="h-3 w-3" /> Locked Elements (Must Replicate)
              </dt>
              <div className="flex flex-wrap gap-2">
                {lockedEls.map((el, i) => (
                  <span key={i} className="rounded-full bg-green-500/10 text-green-600 dark:text-green-400 px-3 py-1 text-xs">
                    {el}
                  </span>
                ))}
              </div>
            </div>
          )}
          {variableEls.length > 0 && (
            <div>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Unlock className="h-3 w-3" /> Variable Elements (Adapt for Brand)
              </dt>
              <div className="flex flex-wrap gap-2">
                {variableEls.map((el, i) => (
                  <span key={i} className="rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-1 text-xs">
                    {el}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Compliance */}
      {complianceReqs.length > 0 && (
        <Section title="Compliance" icon={Shield} defaultOpen={false}>
          <ul className="space-y-1.5">
            {complianceReqs.map((req, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Shield className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                <span className="text-foreground">{req}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Source Reference (collapsible) */}
      {brief.sourceSnapshot && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => setSourceOpen(!sourceOpen)}
            className="flex w-full items-center justify-between px-5 py-3.5 bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Source Reference</span>
              <span className="text-xs text-muted-foreground">
                (Original {brief.sourceType === "competitor_ad" ? "ad" : "post"} analysis)
              </span>
            </div>
            {sourceOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {sourceOpen && (
            <div className="px-5 py-4">
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground bg-muted/30 rounded-lg p-4 max-h-96 overflow-y-auto">
                {JSON.stringify(brief.sourceSnapshot, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
