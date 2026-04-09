"use client";

import { cn } from "@/lib/utils";
import { ImageIcon } from "lucide-react";

export type AdStyle = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  masterPrompt: string;
  referenceImageUrl: string | null;
  thumbnailUrl: string | null;
  aspectRatio: string;
  sortOrder: number;
  hasPrompt?: boolean;
};

type StylePickerProps = {
  styles: (AdStyle & { hasPrompt?: boolean })[];
  selectedId: string | null;
  onSelect: (style: AdStyle) => void;
};

export function StylePicker({ styles, selectedId, onSelect }: StylePickerProps) {
  if (styles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ImageIcon className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No ad styles available yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {styles.map((style) => {
        const isSelected = selectedId === style.id;
        const isAvailable = style.hasPrompt !== false;

        return (
          <button
            key={style.id}
            onClick={() => isAvailable && onSelect(style)}
            disabled={!isAvailable}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-all duration-150 text-left",
              !isAvailable
                ? "border-border/50 opacity-35 cursor-not-allowed"
                : isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/30"
            )}
          >
            {/* Radio indicator */}
            <div className={cn(
              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all",
              !isAvailable
                ? "border-muted-foreground/20"
                : isSelected
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/30"
            )}>
              {isSelected && isAvailable && (
                <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
              )}
            </div>

            {/* Name + description */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className={cn(
                  "text-[13px] font-semibold whitespace-nowrap",
                  !isAvailable
                    ? "text-muted-foreground/60"
                    : isSelected ? "text-primary" : "text-foreground"
                )}>
                  {style.name}
                </p>
                {!isSelected && style.description && (
                  <p className="text-[11px] text-muted-foreground/60 truncate">
                    {style.description}
                  </p>
                )}
                {!isAvailable && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                    No prompt
                  </span>
                )}
              </div>
              {isSelected && style.description && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {style.description}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
