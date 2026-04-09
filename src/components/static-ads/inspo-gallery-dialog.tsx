"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ReferenceItem = {
  id: string;
  name: string;
  imageUrl: string;    // raw R2 URL (for backend)
  previewUrl: string;  // presigned URL (for display)
  industry: string;
  adType: string | null;
  brand: string | null;
};

type InspoGalleryDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (ref: { id: string; name: string; imageUrl: string; previewUrl: string }) => void;
};

export function InspoGalleryDialog({ open, onClose, onSelect }: InspoGalleryDialogProps) {
  const [refs, setRefs] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);

  const fetchRefs = useCallback(async () => {
    setLoading(true);
    try {
      const url = selectedIndustry
        ? `/api/reference-library?industry=${encodeURIComponent(selectedIndustry)}`
        : "/api/reference-library";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRefs(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedIndustry]);

  useEffect(() => {
    if (open) fetchRefs();
  }, [open, fetchRefs]);

  // Extract unique industries for filter pills
  const industries = [...new Set(refs.map((r) => r.industry))].sort();
  // If we have a filter and fetched filtered results, show all industries from unfiltered
  // For simplicity, fetch all first time, then filter client-side
  const [allRefs, setAllRefs] = useState<ReferenceItem[]>([]);

  useEffect(() => {
    if (open && allRefs.length === 0) {
      fetch("/api/reference-library")
        .then((r) => r.json())
        .then((data) => {
          setAllRefs(data);
          setRefs(data);
        })
        .catch(() => {});
    }
  }, [open, allRefs.length]);

  // Client-side filtering
  const allIndustries = [...new Set(allRefs.map((r) => r.industry))].sort();
  const industryCounts = allIndustries.reduce(
    (acc, ind) => {
      acc[ind] = allRefs.filter((r) => r.industry === ind).length;
      return acc;
    },
    {} as Record<string, number>
  );

  const filteredRefs = selectedIndustry
    ? allRefs.filter((r) => r.industry === selectedIndustry)
    : allRefs;

  const handleSelect = (ref: ReferenceItem) => {
    onSelect({
      id: ref.id,
      name: ref.name,
      imageUrl: ref.imageUrl,
      previewUrl: ref.previewUrl,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Inspo Gallery</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Browse {allRefs.length} reference ads and pick one for your generation
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Industry filters */}
        {allIndustries.length > 0 && (
          <div className="px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setSelectedIndustry(null)}
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-medium transition-all whitespace-nowrap",
                  !selectedIndustry
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
              >
                All ({allRefs.length})
              </button>
              {allIndustries.map((ind) => (
                <button
                  key={ind}
                  onClick={() => setSelectedIndustry(ind === selectedIndustry ? null : ind)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[10px] font-medium transition-all whitespace-nowrap",
                    selectedIndustry === ind
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  )}
                >
                  {ind} ({industryCounts[ind]})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && allRefs.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30" />
            </div>
          ) : filteredRefs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40">
              <Search className="h-8 w-8 mb-2" />
              <p className="text-sm">No references found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filteredRefs.map((ref) => (
                <button
                  key={ref.id}
                  onClick={() => handleSelect(ref)}
                  className="group relative rounded-xl border border-border bg-card overflow-hidden hover:border-primary/60 hover:shadow-[0_0_12px_rgba(178,255,0,0.1)] transition-all duration-200 text-left"
                >
                  <div className="aspect-[3/4] bg-muted/30 overflow-hidden">
                    <img
                      src={ref.previewUrl}
                      alt={ref.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="px-2.5 py-2 space-y-1">
                    <p className="text-[10px] font-medium text-foreground truncate">
                      {ref.name}
                    </p>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[8px] text-muted-foreground">
                        {ref.industry}
                      </span>
                      {ref.adType && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] text-primary">
                          {ref.adType}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
