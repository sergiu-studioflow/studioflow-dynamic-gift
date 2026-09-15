"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * "N held by Quality Control" above a request's generated rows. Held rows are hidden from the
 * default view, so without this a run whose output was all flagged read as having produced
 * nothing.
 */
export function HeldByQcNotice({
  count,
  singular,
  plural,
  showing,
  onToggle,
}: {
  count: number;
  singular: string;
  plural: string;
  showing: boolean;
  onToggle: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 font-medium text-rose-600 dark:text-rose-400">
        <ShieldAlert className="h-3.5 w-3.5" />
        {count} {count === 1 ? singular : plural} held by Quality Control
      </span>
      <span className="text-muted-foreground">
        {showing ? "Shown below with their QC status." : "Hidden from this list until approved."}
      </span>
      <button type="button" onClick={onToggle} className="font-medium text-primary hover:underline">
        {showing ? "Hide held" : "Show held"}
      </button>
      <Link href="/quality-control" className="ml-auto text-muted-foreground hover:text-foreground hover:underline">
        Review in Quality Control →
      </Link>
    </div>
  );
}
