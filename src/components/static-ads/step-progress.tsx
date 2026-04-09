"use client";

import { CheckCircle2, Loader2, Circle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepStatus = "pending" | "active" | "complete" | "error";

export type Step = {
  label: string;
  status: StepStatus;
  detail?: string;
};

type StepProgressProps = {
  steps: Step[];
};

export function StepProgress({ steps }: StepProgressProps) {
  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-3">
          {/* Vertical line + icon */}
          <div className="flex flex-col items-center">
            <div className="flex items-center justify-center h-7 w-7 shrink-0">
              {step.status === "complete" && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
              {step.status === "active" && (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              {step.status === "pending" && (
                <Circle className="h-5 w-5 text-muted-foreground/30" />
              )}
              {step.status === "error" && (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
            </div>
            {/* Connector line (except last) */}
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "w-px h-6",
                  step.status === "complete"
                    ? "bg-green-500/30"
                    : "bg-border"
                )}
              />
            )}
          </div>

          {/* Text */}
          <div className="pt-1">
            <p
              className={cn(
                "text-sm font-medium leading-tight",
                step.status === "active" && "text-foreground",
                step.status === "complete" && "text-muted-foreground",
                step.status === "pending" && "text-muted-foreground/40",
                step.status === "error" && "text-red-500"
              )}
            >
              {step.label}
            </p>
            {step.detail && (
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                {step.detail}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
