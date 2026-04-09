"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  Plus,
  X,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ReferenceAd = {
  id: string;
  name: string;
  imageUrl: string;
  industry: string;
  adType: string | null;
  brand: string | null;
  tags: string | null;
  isActive: boolean;
};

export function ReferenceLibraryManager() {
  const [refs, setRefs] = useState<ReferenceAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filterIndustry, setFilterIndustry] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchRefs = useCallback(async () => {
    setLoading(true);
    const url = filterIndustry
      ? `/api/reference-library?industry=${encodeURIComponent(filterIndustry)}`
      : "/api/reference-library";
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data)) setRefs(data);
    setLoading(false);
  }, [filterIndustry]);

  useEffect(() => {
    fetchRefs();
  }, [fetchRefs]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
        formData.append("industry", filterIndustry || "beauty");

        const res = await fetch("/api/reference-library", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Upload failed");
          return;
        }

        await fetchRefs();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [filterIndustry, fetchRefs]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Remove this reference image?")) return;
      await fetch(`/api/reference-library/${id}`, { method: "DELETE" });
      setRefs((prev) => prev.filter((r) => r.id !== id));
    },
    []
  );

  // Build dynamic industry list from data
  const industryCounts = refs.reduce<Record<string, number>>((acc, r) => {
    acc[r.industry] = (acc[r.industry] || 0) + 1;
    return acc;
  }, {});
  const industries = Object.keys(industryCounts).sort();

  return (
    <div>
      {/* Industry filter + upload button */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setFilterIndustry("")}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
            !filterIndustry
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          All ({refs.length})
        </button>
        {industries.map((ind) => (
          <button
            key={ind}
            onClick={() => setFilterIndustry(ind)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              filterIndustry === ind
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            {ind} ({industryCounts[ind]})
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:brightness-110 transition-all disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add Reference
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30" />
        </div>
      ) : refs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground/40">
          <FolderOpen className="h-10 w-10" />
          <p className="text-sm">No reference ads yet</p>
          <p className="text-[10px]">Sync from Airtable or upload manually</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {refs.map((ref) => (
            <div
              key={ref.id}
              className="group relative rounded-lg border border-border bg-muted/20 overflow-hidden"
            >
              <div className="aspect-[4/5] bg-muted flex items-center justify-center">
                <img
                  src={ref.imageUrl}
                  alt={ref.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <div className="px-2 py-1.5">
                <p className="text-[10px] font-medium text-foreground truncate">
                  {ref.brand || ref.name}
                </p>
                <div className="flex items-center gap-1 flex-wrap mt-0.5">
                  <span className="text-[9px] text-muted-foreground">
                    {ref.industry}
                  </span>
                  {ref.adType && (
                    <span className="text-[8px] rounded bg-muted px-1 py-0.5 text-muted-foreground">
                      {ref.adType.split(",")[0]}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(ref.id)}
                className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
