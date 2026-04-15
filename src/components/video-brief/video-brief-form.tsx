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
import { Loader2, Sparkles } from "lucide-react";

const CONTENT_TYPES = [
  "UGC",
  "B-Roll",
  "Product Demo",
  "Testimonial Compilation",
  "Behind the Scenes",
  "Case Study",
] as const;

const PLATFORMS = ["Facebook", "Instagram", "LinkedIn"] as const;

const TARGET_PERSONAS = [
  "Corporate Marketing/Procurement",
  "Event Organiser",
  "Small Business Owner",
  "Government/Institutional",
] as const;

const FUNNEL_STAGES = ["Awareness", "Consideration", "Decision"] as const;

const DURATIONS = ["15s", "30s", "60s", "90s"] as const;

const HOOK_STYLES = [
  "Question",
  "Statistic",
  "Pattern Interrupt",
  "Emotional",
  "Curiosity Gap",
] as const;

const VALUE_PROP_OPTIONS = [
  "Concierge Service",
  "Speed",
  "Price",
  "Scale",
  "Design",
  "End-to-End",
  "Range",
] as const;

type VideoBriefFormProps = {
  onSuccess?: () => void;
};

export function VideoBriefForm({ onSuccess }: VideoBriefFormProps) {
  const [brands, setBrands] = useState<{ id: string; brandName: string }[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [brand, setBrand] = useState("");
  const [contentType, setContentType] = useState("");
  const [platform, setPlatform] = useState("");
  const [targetPersona, setTargetPersona] = useState("");
  const [funnelStage, setFunnelStage] = useState("");
  const [duration, setDuration] = useState("");
  const [hookStyle, setHookStyle] = useState("");
  const [valuePropFocus, setValuePropFocus] = useState("");
  const [scenarioDirection, setScenarioDirection] = useState("");
  const [productFocus, setProductFocus] = useState("");
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

  async function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!brand) {
      setError("Please select a brand");
      return;
    }
    if (!scenarioDirection.trim()) {
      setError("Please describe the scenario direction");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/video-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand,
          contentType: contentType || undefined,
          platform: platform || undefined,
          targetPersona: targetPersona || undefined,
          funnelStage: funnelStage || undefined,
          duration: duration || undefined,
          hookStyle: hookStyle || undefined,
          valuePropFocus: valuePropFocus || undefined,
          scenarioDirection: scenarioDirection.trim(),
          productFocus: productFocus.trim() || undefined,
          additionalContext: additionalContext.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create request");
      }

      setSuccess(true);
      setBrand("");
      setContentType("");
      setPlatform("");
      setTargetPersona("");
      setFunnelStage("");
      setDuration("");
      setHookStyle("");
      setValuePropFocus("");
      setScenarioDirection("");
      setProductFocus("");
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
                <SelectItem key={b.id} value={b.brandName}>
                  {b.brandName}
                </SelectItem>
              ))}
              {brands.length === 0 && !brandsLoading && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No brands configured. Add brands in Brand Intelligence.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Scenario Direction */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Scenario Direction *
          </label>
          <Textarea
            value={scenarioDirection}
            onChange={(e) => setScenarioDirection(e.target.value)}
            placeholder="Describe the video scenario, key message, campaign angle, or creative direction..."
            rows={3}
          />
        </div>

        {/* Content & Platform Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Content Type</label>
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Platform</label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="Select platform..." />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Audience Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Target Persona</label>
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

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Funnel Stage</label>
            <Select value={funnelStage} onValueChange={setFunnelStage}>
              <SelectTrigger>
                <SelectValue placeholder="Select stage..." />
              </SelectTrigger>
              <SelectContent>
                {FUNNEL_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Creative Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Duration</label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Hook Style</label>
            <Select value={hookStyle} onValueChange={setHookStyle}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {HOOK_STYLES.map((h) => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Value Prop Focus</label>
            <Select value={valuePropFocus} onValueChange={setValuePropFocus}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {VALUE_PROP_OPTIONS.map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Product Focus */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Product Focus <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Textarea
            value={productFocus}
            onChange={(e) => setProductFocus(e.target.value)}
            placeholder="Specific product, service, or range to highlight..."
            rows={2}
          />
        </div>

        {/* Additional Context */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Additional Context <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="Campaign notes, competitor references, seasonal themes, existing assets to leverage..."
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
            Video brief is being generated! Switching to Brief Library...
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
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {submitting ? "Generating..." : "Generate Video Brief"}
        </Button>
      </CardContent>
    </Card>
  );
}
