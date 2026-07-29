// Shared "shippable" predicate for the hard gate. A generated piece may leave the staging
// area (download / Winners / posting queue / auto-publish) only when qc_status is approved
// (passed the gate or human-approved) or skipped (grandfathered / exempt mode).

import { inArray, notInArray, type AnyColumn } from "drizzle-orm";
import { QC_SHIPPABLE } from "./constants";

export { QC_SHIPPABLE };

// Pieces the gate HOLDS back: AI-flagged or human-rejected. Everything else
// (pending / approved / skipped, plus in-flight generating rows) stays visible in the
// gallery — only download / Winners / posting are hard-blocked unless QC_SHIPPABLE.
export const QC_HELD: readonly string[] = ["flagged", "rejected"];

/** Strict shippable predicate (download / Winners / posting eligibility). */
export function shippableQc(col: AnyColumn) {
  return inArray(col, QC_SHIPPABLE as unknown as string[]);
}

/** Gallery/list predicate: show everything EXCEPT held pieces (keeps generation visible). */
export function notHeldQc(col: AnyColumn) {
  return notInArray(col, QC_HELD as unknown as string[]);
}

/** Held-for-review predicate (the ?qc=flagged view). */
export function heldQc(col: AnyColumn) {
  return inArray(col, QC_HELD as unknown as string[]);
}

/** Plain check for route guards / UI. Treats null/undefined as 'skipped' (legacy-safe). */
export function isShippable(qcStatus?: string | null): boolean {
  return QC_SHIPPABLE.includes(qcStatus ?? "skipped");
}

/** Translate a ?qc= query param into a predicate, or null for "no filter". */
export function qcFilterCondition(qc: string | null | undefined, col: AnyColumn) {
  if (qc === "ready") return shippableQc(col);
  if (qc === "flagged") return heldQc(col);
  if (qc === "all") return null;
  return notHeldQc(col); // default view
}
