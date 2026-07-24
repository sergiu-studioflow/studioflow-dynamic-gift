"use client";

import { useState } from "react";
import { Send, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  sourceType: "static_ad" | "winner" | "video" | "review_graphic";
  sourceId: string;
  disabled?: boolean;
  className?: string;
  label?: string;
};

/**
 * Drop-in "Send to Post Scheduler" button. Posts to /api/posting/queue and
 * shows an inline queued/error state. Used on static-ad, winner, and approved
 * review-graphic cards.
 */
export function SendToQueueButton({ sourceType, sourceId, disabled, className, label = "Send to Scheduler" }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  async function send() {
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/posting/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceType, sourceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMsg(data.error || "Failed to queue");
        setTimeout(() => setState("idle"), 3500);
        return;
      }
      setState("done");
      setTimeout(() => setState("idle"), 3000);
    } catch {
      setState("error");
      setMsg("Network error");
      setTimeout(() => setState("idle"), 3500);
    }
  }

  return (
    <button
      onClick={send}
      disabled={disabled || state === "loading" || state === "done"}
      title={msg || label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-all hover:bg-accent disabled:opacity-60",
        state === "error" && "border-destructive text-destructive",
        state === "done" && "border-emerald-500 text-emerald-500",
        className
      )}
    >
      {state === "loading" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Send className="h-3.5 w-3.5" />
      )}
      {state === "done" ? "Queued" : state === "error" ? msg || "Error" : label}
    </button>
  );
}
