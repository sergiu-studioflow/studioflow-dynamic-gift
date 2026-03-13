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
  { id: "Review/Testimonial", label: "Review / Testimonial Angles", desc: "Leverage 2,000+ Google reviews" },
  { id: "Product Features", label: "Product Features with Value Framing", desc: "Use-case driven, not bare announcements" },
  { id: "Behind the Scenes", label: "Behind the Scenes / How It's Made", desc: "Design team, warehouse, production process" },
  { id: "Value Prop Reinforcement", label: "Value Prop Reinforcement", desc: "Speed, price, full-service, concierge" },
  { id: "Educational", label: "Educational Content", desc: "Tips, guides, industry insights" },
  { id: "Case Study", label: "Case Study / Project Showcase", desc: "Little Mix tour, Red Bull, major projects" },
];

type IdeationFormProps = {
  onSuccess?: () => void;
};

export function IdeationForm({ onSuccess }: IdeationFormProps) {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [brand, setBrand] = useState("");
  const [direction, setDirection] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [numberOfIdeas, setNumberOfIdeas] = useState("25");
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

  function toggleType(typeId: string) {
    setSelectedTypes((prev) =>
      prev.includes(typeId)
        ? prev.filter((t) => t !== typeId)
        : [...prev, typeId]
    );
  }

  async function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!brand) {
      setError("Please select a brand");
      return;
    }
    if (!direction.trim()) {
      setError("Please describe the content direction");
      return;
    }
    if (selectedTypes.length === 0) {
      setError("Please select at least one content type");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/ideation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand,
          direction: direction.trim(),
          contentTypes: selectedTypes,
          numberOfIdeas: parseInt(numberOfIdeas, 10),
          additionalContext: additionalContext.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create request");
      }

      setSuccess(true);
      setBrand("");
      setDirection("");
      setSelectedTypes([]);
      setNumberOfIdeas("25");
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
                  No brands configured. Add brands in Brand Intelligence.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Direction */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Content Direction *
          </label>
          <Textarea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Describe the general content direction, campaign theme, or specific angles to explore..."
            rows={3}
          />
        </div>

        {/* Content Types */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">
            Content Types * <span className="text-muted-foreground font-normal">(select at least one)</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CONTENT_TYPES.map((type) => {
              const isSelected = selectedTypes.includes(type.id);
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => toggleType(type.id)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left transition-all duration-150 ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border hover:border-primary/30 hover:bg-muted/50"
                  }`}
                >
                  <span className={`text-sm font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
                    {type.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{type.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Number of Ideas */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Number of Ideas
          </label>
          <Select value={numberOfIdeas} onValueChange={setNumberOfIdeas}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 15, 20, 25, 30].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} ideas
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Additional Context */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Additional Context <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="Seasonal themes, competitor notes, specific products to feature, upcoming campaigns..."
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
            Ideas are being generated! Switching to Idea Library...
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
          {submitting ? "Generating..." : "Generate Ideas"}
        </Button>
      </CardContent>
    </Card>
  );
}
