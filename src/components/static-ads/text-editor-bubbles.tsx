"use client";

import { Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export type EditableTextElement = {
  name: string;
  currentText: string;
  newText: string;
  editPriority: "high" | "medium" | "low" | "do-not-edit";
};

type TextEditorBubblesProps = {
  elements: EditableTextElement[];
  onChange: (index: number, newText: string) => void;
  disabled?: boolean;
};

export function TextEditorBubbles({ elements, onChange, disabled }: TextEditorBubblesProps) {
  const editableElements = elements.filter((e) => e.editPriority !== "do-not-edit");
  const lockedElements = elements.filter((e) => e.editPriority === "do-not-edit");

  return (
    <div className="flex flex-col gap-2">
      {/* Editable elements */}
      {editableElements.map((el) => {
        const globalIndex = elements.indexOf(el);
        const isModified = el.newText !== el.currentText;
        const isHigh = el.editPriority === "high";

        return (
          <div
            key={globalIndex}
            className={cn(
              "rounded-lg border p-3 transition-all",
              isHigh ? "border-primary/30 bg-primary/5" : "border-border bg-card",
              isModified && "ring-1 ring-primary/50"
            )}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider",
                  isHigh ? "text-primary" : "text-muted-foreground"
                )}
              >
                {el.name}
              </span>
              {isModified && (
                <span className="text-[9px] rounded-full bg-primary/20 text-primary px-1.5 py-0.5 font-medium">
                  modified
                </span>
              )}
              <Pencil className="h-3 w-3 text-muted-foreground/30 ml-auto" />
            </div>
            <input
              type="text"
              value={el.newText}
              onChange={(e) => onChange(globalIndex, e.target.value)}
              disabled={disabled}
              className={cn(
                "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground",
                "focus:outline-none focus:ring-1 focus:ring-primary/50",
                "placeholder:text-muted-foreground/40",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            />
            {isModified && (
              <p className="mt-1 text-[9px] text-muted-foreground/50">
                Was: &ldquo;{el.currentText}&rdquo;
              </p>
            )}
          </div>
        );
      })}

      {/* Separator */}
      {lockedElements.length > 0 && (
        <div className="flex items-center gap-2 py-2">
          <div className="flex-1 border-t border-border" />
          <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">
            Do Not Edit
          </span>
          <div className="flex-1 border-t border-border" />
        </div>
      )}

      {/* Locked elements */}
      {lockedElements.map((el) => {
        const globalIndex = elements.indexOf(el);
        return (
          <div
            key={globalIndex}
            className="rounded-lg border border-border/50 bg-muted/20 p-3 opacity-60"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                {el.name}
              </span>
              <Lock className="h-3 w-3 text-muted-foreground/30 ml-auto" />
            </div>
            <p className="text-sm text-muted-foreground/60 truncate">
              {el.currentText}
            </p>
          </div>
        );
      })}
    </div>
  );
}
