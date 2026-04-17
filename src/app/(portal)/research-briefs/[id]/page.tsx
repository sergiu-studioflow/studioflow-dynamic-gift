"use client";

import { useState, useEffect } from "react";
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
      <dd className="text-sm text-foreground">{value}</dd>
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

  useEffect(() => {
    async function fetchBrief() {
      try {
        const res = await fetch(`/api/research-briefs/${params.id}`);
        if (res.ok) setBrief(await res.json());
      } finally {
        setLoading(false);
      }
    }
    fetchBrief();
  }, [params.id]);

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

  const MediaIcon = mediaTypeIcons[brief.mediaType] || FileText;
  const shotList = brief.shotList as Array<{ timecode: string; shot: string; description: string; onScreenText?: string }> | null;
  const visualComp = brief.visualComposition as { layout: string; colorPalette: string; typography: string; hierarchy: string } | null;
  const cardDirs = brief.cardDirections as Array<{ cardNumber: number; angle: string; visual: string; copy: string; cta: string }> | null;
  const onScreenText = brief.onScreenText as Array<{ text: string; timing: string; placement: string; style?: string }> | null;
  const hookVariations = brief.hookVariations as string[] | null;
  const complianceReqs = brief.complianceRequirements as string[] | null;
  const lockedEls = brief.lockedElements as string[] | null;
  const variableEls = brief.variableElements as string[] | null;

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
          {brief.funnelStage && (
            <Badge variant="outline" className={funnelColors[brief.funnelStage] || ""}>
              {brief.funnelStage}
            </Badge>
          )}
          {brief.creativeFormat && (
            <Badge variant="outline">{brief.creativeFormat}</Badge>
          )}
          <Badge variant="outline" className="text-muted-foreground">
            {brief.mediaType}
          </Badge>
        </div>
        <h1 className="text-2xl font-bold text-foreground">{brief.title}</h1>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3" />
            {brief.sourceType === "competitor_ad" ? "From Meta Ad" : "From Organic Post"}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(brief.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </span>
          {brief.generationDurationMs && (
            <span>Generated in {(brief.generationDurationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>

      {/* Strategic Foundation */}
      <Section title="Strategic Foundation" icon={Brain}>
        <Field label="Strategic Hypothesis" value={brief.strategicHypothesis} />
        <Field label="Psychology Angle" value={brief.psychologyAngle} />
        <Field label="Target Persona" value={brief.targetPersona} />
      </Section>

      {/* Hooks */}
      <Section title="Hooks" icon={Sparkles}>
        <Field label="Primary Hook" value={brief.primaryHook} />
        {hookVariations && hookVariations.length > 0 && (
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
        <Field label="Visual Direction" value={brief.visualDirection} />

        {/* Video: Shot List */}
        {shotList && shotList.length > 0 && (
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
                  {shotList.map((shot, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-primary whitespace-nowrap">{shot.timecode}</td>
                      <td className="px-3 py-2 font-medium">{shot.shot}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shot.description}</td>
                      <td className="px-3 py-2 text-muted-foreground">{shot.onScreenText || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Static: Visual Composition */}
        {visualComp && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Layout" value={visualComp.layout} />
            <Field label="Color Palette" value={visualComp.colorPalette} />
            <Field label="Typography" value={visualComp.typography} />
            <Field label="Visual Hierarchy" value={visualComp.hierarchy} />
          </div>
        )}

        {/* Carousel: Card Directions */}
        {cardDirs && cardDirs.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Card-by-Card Direction
            </dt>
            <div className="space-y-3">
              {cardDirs.map((card, i) => (
                <div key={i} className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-primary">Card {card.cardNumber}</div>
                  <Field label="Angle" value={card.angle} />
                  <Field label="Visual" value={card.visual} />
                  <Field label="Copy" value={card.copy} />
                  <Field label="CTA" value={card.cta} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* On-Screen Text */}
        {onScreenText && onScreenText.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              On-Screen Text Overlays
            </dt>
            <div className="space-y-2">
              {onScreenText.map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <Type className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">&ldquo;{item.text}&rdquo;</span>
                    <span className="text-muted-foreground"> — {item.timing}, {item.placement}</span>
                    {item.style && <span className="text-muted-foreground/60"> ({item.style})</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Audio & Voice */}
      {(brief.audioDirection || brief.brandVoiceLock) && (
        <Section title="Audio & Voice" icon={Volume2}>
          <Field label="Audio Direction" value={brief.audioDirection} />
          <Field label="Brand Voice Lock" value={brief.brandVoiceLock} />
        </Section>
      )}

      {/* Execution Guide */}
      {((lockedEls && lockedEls.length > 0) || (variableEls && variableEls.length > 0)) && (
        <Section title="Execution Guide" icon={Lock}>
          {lockedEls && lockedEls.length > 0 && (
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
          {variableEls && variableEls.length > 0 && (
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
      {complianceReqs && complianceReqs.length > 0 && (
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
