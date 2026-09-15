"use client";

import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BrandOption } from "@/lib/types";

type BrandSelectProps = {
  /** The selected brand's name — what the generate routes validate and store. */
  value: string;
  onValueChange: (brandName: string) => void;
  /**
   * The brand selected in the sidebar switcher (its id). It is picked whenever it changes and
   * whenever the field is empty (e.g. after a submit resets the form); a different brand chosen
   * here by hand is left alone. Ignored when it isn't an active brand.
   */
  preselectId?: string | null;
};

// The one brand picker for the generation forms. It replaced three hand-copied pickers:
// the Multi-Client migration renamed brands.name → brandName, updated two of them, and
// the third (Content Ideation) rendered blank, unselectable rows for five months.
export function BrandSelect({ value, onValueChange, preselectId }: BrandSelectProps) {
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loading, setLoading] = useState(true);
  const appliedPreselect = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/brands")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: BrandOption[]) => setBrands(Array.isArray(data) ? data : []))
      .catch(() => setBrands([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !preselectId) return;
    if (appliedPreselect.current === preselectId && value) return;
    const match = brands.find((b) => b.id === preselectId);
    if (!match) return;
    appliedPreselect.current = preselectId;
    if (value !== match.brandName) onValueChange(match.brandName);
  }, [loading, brands, preselectId, value, onValueChange]);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={loading}>
      <SelectTrigger>
        <SelectValue placeholder={loading ? "Loading brands..." : "Select a brand..."} />
      </SelectTrigger>
      <SelectContent>
        {brands.map((b) => (
          <SelectItem key={b.id} value={b.brandName}>
            {b.brandName}
          </SelectItem>
        ))}
        {brands.length === 0 && !loading && (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            No brands configured. Add one under Clients.
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
