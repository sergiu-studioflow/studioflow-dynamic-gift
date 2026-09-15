// Starting a text-generation run. The n8n webhooks respond as soon as they receive the
// request (the run itself takes minutes), so the call is awaited: a fire-and-forget fetch in a
// serverless function can be dropped when the response returns, which left requests "new"
// forever, and a non-2xx answer (webhook unregistered, n8n down) was never noticed.

const WEBHOOK_TIMEOUT_MS = 8_000;

export const TEXT_WORKFLOW_PATHS = {
  ideation: "generate-dynamic-gift-ideation",
  adCopy: "generate-dynamic-gift-ad-copy",
  videoBrief: "generate-dynamic-gift-video-brief",
} as const;

/**
 * Fire the n8n webhook for one request. Resolves to null once n8n has accepted it, or to a
 * user-facing reason it could not be started (for the request's error_message).
 */
export async function startTextWorkflow(webhookPath: string, requestId: string): Promise<string | null> {
  const base = (process.env.N8N_WEBHOOK_BASE || "https://studio-flow.app.n8n.cloud").trim().replace(/\/+$/, "");
  const url = `${base}/webhook/${webhookPath}?requestId=${encodeURIComponent(requestId)}`;

  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
    if (res.ok) return null;
    const detail = await res.text().catch(() => "");
    console.error(`[n8n] ${webhookPath} rejected request ${requestId}: HTTP ${res.status} ${detail.slice(0, 300)}`);
    return `Generation could not be started — the workflow service answered HTTP ${res.status}. Use Retry to try again.`;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      // No answer in time: n8n may still have received it (a slow instance), so don't mark a
      // run that could be in progress as failed. If it never starts, the library offers
      // Retry once the request has sat unfinished for 20 minutes.
      console.warn(`[n8n] ${webhookPath} did not answer within ${WEBHOOK_TIMEOUT_MS}ms for request ${requestId}`);
      return null;
    }
    console.error(`[n8n] ${webhookPath} unreachable for request ${requestId}:`, err);
    return "Generation could not be started — the workflow service could not be reached. Use Retry to try again.";
  }
}
