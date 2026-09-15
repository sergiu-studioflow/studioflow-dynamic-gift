// Shared plumbing for the three text-system completion callbacks (ideation, ad copy, video
// brief). n8n writes the generated rows and the request status itself, then POSTs
// { requestId, status } with the x-webhook-secret header — the callback only gates what was
// written.

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fails closed: with no WEBHOOK_SECRET configured every callback is rejected, never accepted. */
export function hasValidWebhookSecret(request: NextRequest): boolean {
  // Trimmed: a secret pasted into Vercel with a trailing newline must not silently break every callback.
  const expected = (process.env.WEBHOOK_SECRET ?? "").trim();
  const given = (request.headers.get("x-webhook-secret") ?? "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type CompletionCallback = {
  requestId: string;
  /** n8n reported the run as failed. */
  failed: boolean;
  errorMessage: string | null;
};

/**
 * The status change (if any) a callback should make. n8n records the status itself before it
 * calls back, so this only fills gaps:
 *   - a failed run, or one that "finished" with nothing saved, must not sit as complete —
 *     it becomes error, which offers Retry;
 *   - rows saved but the request not marked complete → complete.
 * A request that is new/processing is never failed from here: n8n already wrote its status,
 * so an in-flight request means this callback belongs to an earlier run (or n8n couldn't
 * write the status — the library offers Retry on requests stuck for 20 minutes).
 */
export function callbackStatusUpdate(o: {
  current: string;
  inFlightStatuses: readonly string[];
  callback: CompletionCallback;
  saved: number;
  noun: string;
}): { status: "complete" | "error"; errorMessage: string | null } | null {
  if (o.callback.failed || o.saved === 0) {
    if (o.current === "error" || o.inFlightStatuses.includes(o.current)) return null;
    return {
      status: "error",
      errorMessage:
        o.callback.errorMessage ??
        (o.callback.failed
          ? "Generation failed. Use Retry to run it again."
          : `The run finished without saving any ${o.noun}. Use Retry to run it again.`),
    };
  }
  return o.current === "complete" ? null : { status: "complete", errorMessage: null };
}

export async function parseCompletionCallback(request: NextRequest): Promise<CompletionCallback | { error: string }> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return { error: "JSON body required" };
  const b = body as Record<string, unknown>;

  const requestId = typeof b.requestId === "string" ? b.requestId.trim() : "";
  if (!UUID_RE.test(requestId)) return { error: "requestId (uuid) required" };

  const status = typeof b.status === "string" ? b.status.trim().toLowerCase() : "complete";
  const errorText = [b.error, b.errorMessage].find((v): v is string => typeof v === "string" && v.trim() !== "");
  return {
    requestId,
    failed: status === "error" || status === "failed" || !!errorText,
    errorMessage: errorText ? errorText.trim().slice(0, 1000) : null,
  };
}
