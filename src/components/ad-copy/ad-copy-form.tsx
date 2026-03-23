"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Megaphone } from "lucide-react";

const CAMPAIGN_OBJECTIVES = [
  "Lead Generation",
  "Brand Awareness",
  "Traffic",
  "Engagement",
  "Retargeting",
] as const;

const TARGET_PERSONAS = [
  "Corporate Marketing/Procurement",
  "Event Organiser",
  "Small Business Owner",
  "Government/Institutional",
] as const;

const CORE_ANGLES = [
  { value: "Speed & Turnaround", label: "Speed & Turnaround", desc: "Fastest in Australia" },
  { value: "Full-Service Concierge", label: "Full-Service Concierge", desc: "We handle everything" },
  { value: "Price Competitiveness", label: "Price Competitiveness", desc: "Direct importing, no middlemen" },
  { value: "Proof Points & Credibility", label: "Proof Points & Credibility", desc: "2,000+ reviews, major brand clients" },
  { value: "Objection Handling", label: "Objection Handling", desc: "Pre-empt buyer hesitations" },
] as const;

const AD_FORMATS = ["Single Image", "Carousel", "Video"] as const;

const TONE_VARIATIONS = [
  "Confident Direct",
  "Problem-Solution",
  "Social Proof Heavy",
  "Urgency",
  "Conversational",
] as const;

type AdCopyFormProps = {
  onSuccess?: () => void;
};

export function AdCopyForm({ onSuccess }: AdCopyFormProps) {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [brand, setBrand] = useState("");
  const [campaignObjective, setCampaignObjective] = useState("");
  const [targetPersona, setTargetPersona] = useState("");
  const [productFocus, setProductFocus] = useState("");
  const [angleEmphasis, setAngleEmphasis] = useState<string[]>([]);
  const [adFormat, setAdFormat] = useState("");
  const [toneVariation, setToneVariation] = useState("");
  const [numberOfConcepts, setNumberOfConcepts] = useState(3);
  const [additionalContext, setAdditionalContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/brands")
      .then((res) => res.json())
      .then((data) => setBrands(data))
      .catch(() => setBrands([]))
      .finally(() => setBrandsLoading(false));
  }, []);

  function toggleAngle(angle: string) {
    setAngleEmphasis((prev) =>
      prev.includes(angle)
        ? prev.filter((a) => a !== angle)
        : [...prev, angle]
    );
  }

  async function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!brand) {
      setError("Please select a brand");
      return;
    }
    if (!campaignObjective) {
      setError("Please select a campaign objective");
      return;
    }
    if (!targetPersona) {
      setError("Please select a target persona");
      return;
    }
    if (angleEmphasis.length === 0) {
      setError("Please select at least one core angle");
      return;
    }
    if (!adFormat) {
      setError("Please select an ad format");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/ad-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand,
          campaignObjective,
          targetPersona,
          productFocus: productFocus.trim() || undefined,
          angleEmphasis,
          adFormat,
          toneVariation: toneVariation || undefined,
          numberOfConcepts,
          additionalContext: additionalContext.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create request");
      }

      setSuccess(true);
      setBrand("");
      setCampaignObjective("");
      setTargetPersona("");
      setProductFocus("");
      setAngleEmphasis([]);
      setAdFormat("");
      setToneVariation("");
      setNumberOfConcepts(3);
      setAdditionalContext("");

      setTimeout(() => {
        onSuccess?.();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardContent className="space-y-6 pt-6">
        {/* Brand Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Brand *</label>
          <Select value={brand} onValueChange={setBrand} disabled={brandsLoading}>
            <SelectTrigger>
              <SelectValue placeholder={brandsLoading ? "Loading brands..." : "Select a brand..."} />
            </SelectTrigger>
            <SelectContent>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.name}>
                  {b.name}
                </SelectItem>
              ))}
              {brands.length === 0 && !brandsLoading && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No brands configured.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Campaign Objective & Target Persona */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Campaign Objective *</label>
            <Select value={campaignObjective} onValueChange={setCampaignObjective}>
              <SelectTrigger>
                <SelectValue placeholder="Select objective..." />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_OBJECTIVES.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Target Persona *</label>
            <Select value={targetPersona} onValueChange={setTargetPersona}>
              <SelectTrigger>
                <SelectValue placeholder="Select persona..." />
              </SelectTrigger>
              <SelectContent>
                {TARGET_PERSONAS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Core Angle Emphasis — multi-select toggles */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Core Angle Emphasis * <span className="text-muted-foreground font-normal">(select 1+)</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {CORE_ANGLES.map((angle) => {
              const selected = angleEmphasis.includes(angle.value);
              return (
                <button
                  key={angle.value}
                  type="button"
                  onClick={() => toggleAngle(angle.value)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-all duration-150 ${
                    selected
                      ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/30"
                      : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:bg-muted/50"
                  }`}
                >
                  <span className="text-sm font-medium block">{angle.label}</span>
                  <span className="text-[11px] text-muted-foreground">{angle.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Ad Format & Tone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Ad Format *</label>
            <Select value={adFormat} onValueChange={setAdFormat}>
              <SelectTrigger>
                <SelectValue placeholder="Select format..." />
              </SelectTrigger>
              <SelectContent>
                {AD_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Tone <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Select value={toneVariation} onValueChange={setToneVariation}>
              <SelectTrigger>
                <SelectValue placeholder="Select tone..." />
              </SelectTrigger>
              <SelectContent>
                {TONE_VARIATIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Product Focus */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Product/Service Focus <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Textarea
            value={productFocus}
            onChange={(e) => setProductFocus(e.target.value)}
            placeholder="Specific product, service, or range to highlight (e.g., custom lanyards, event displays, branded merchandise)..."
            rows={2}
          />
        </div>

        {/* Number of Concepts */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Number of Concepts
          </label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNumberOfConcepts(n)}
                className={`h-9 w-9 rounded-lg border text-sm font-medium transition-all duration-150 ${
                  numberOfConcepts === n
                    ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/30"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Additional Context */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Additional Context <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="Campaign notes, competitor references, seasonal themes, existing winning ads to build on..."
            rows={2}
          />
        </div>

        {/* Status Messages */}
        {error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-lg bg-primary/10 px-4 py-2.5 text-sm text-primary font-medium">
            Ad copy is being generated! Switching to Copy Library...
          </p>
        )}

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full sm:w-auto"
          size="lg"
        >
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Megaphone className="mr-2 h-4 w-4" />
          )}
          {submitting ? "Generating..." : "Generate Ad Copy"}
        </Button>
      </CardContent>
    </Card>
  );
}
