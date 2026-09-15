/**
 * Publisher engine — runs inside /api/cron/publish-posts (one cron does all).
 *
 * Order per invocation:
 *   A. Resume in-flight IG containers (safe — creating a container publishes nothing).
 *   B. Sweep stuck/ambiguous rows (hard-fail, never auto-resubmit a single-shot post).
 *   C. Atomically claim due targets (UPDATE ... FOR UPDATE SKIP LOCKED).
 *   D. Publish each claimed target (FB photo / IG container→publish), re-checking the
 *      source's Quality Control verdict first.
 *   E. Roll parent status up from its targets.
 *
 * Idempotency: atomic claims (no double-worker), pre-call claim stamps, external
 * ids recorded with the published status, ambiguous rows surfaced to humans. Once a
 * publish request may have reached Meta (network drop, 5xx, or a bookkeeping failure
 * after success) the target is never retried automatically — it becomes ambiguous_stuck.
 */

import { db, schema } from "@/lib/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getApiKey } from "@/lib/api-keys";
import { toExternalUrl } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { BRAND_SLUG } from "@/lib/static-ads/config";
import { composePublishText } from "./platforms";
import { recheckSourceForPublish } from "./sources";
import { makeIgVariant } from "./media";
import {
  MetaGraphError,
  getPageAccessToken,
  publishPagePhoto,
  createIgContainer,
  getIgContainerStatus,
  publishIgContainer,
  getIgPublishingLimit,
  getPermalink,
} from "./meta";

const MAX_ATTEMPTS = 3;
const STUCK_MINUTES = 8;
const IG_QUOTA_GUARD = 45;
const CLAIM_LIMIT = 10;
const IG_INRUN_POLL_MS = 4000;
const IG_INRUN_POLL_TRIES = 9; // ~36s
// The route's maxDuration is 300s. Stop starting targets well before that: a claimed row
// abandoned mid-run would be swept as ambiguous even though nothing was sent.
const RUN_BUDGET_MS = 200_000;
const QC_RECHECK_DELAY_MS = 30 * 60_000;

type Target = typeof schema.postTargets.$inferSelect;
type Parent = typeof schema.scheduledPosts.$inferSelect;
type Account = typeof schema.socialAccounts.$inferSelect;
type Outcome = "published" | "failed" | "in_progress";

export type PublishRunResult = {
  resumed: number;
  stuckFailed: number;
  claimed: number;
  published: number;
  failed: number;
  dryRun: boolean;
  note?: string;
};

/** A publish request may have gone through — terminal, for a human to check. Never retried. */
class AmbiguousPublishError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runPublisher(opts: { dryRun?: boolean } = {}): Promise<PublishRunResult> {
  const dryRun = !!opts.dryRun;
  const started = Date.now();
  const result: PublishRunResult = { resumed: 0, stuckFailed: 0, claimed: 0, published: 0, failed: 0, dryRun };

  const token = (await getApiKey("META_SYSTEM_USER_TOKEN")).trim();

  // Step B always runs (DB-only). Steps A/C/D need a token.
  result.stuckFailed = await sweepStuck(dryRun);

  if (!token) {
    result.note = "META_SYSTEM_USER_TOKEN not configured — publishing skipped.";
    if (!dryRun) await rollupParents();
    return result;
  }

  // Dry run is read-only: report what is due, touch neither Meta nor the queue.
  if (dryRun) {
    result.claimed = await countDueTargets();
    return result;
  }

  result.resumed = await resumeIgContainers(token);

  const claimed = await claimDueTargets();
  result.claimed = claimed.length;

  // Page access tokens, exchanged once per page per run.
  const pageTokens = new Map<string, string>();

  for (let i = 0; i < claimed.length; i++) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      const rest = claimed.slice(i).map((c) => c.target.id);
      await releaseClaims(rest);
      result.note = `Run budget reached — ${rest.length} target(s) released to the next run.`;
      break;
    }
    const { target, parent } = claimed[i];
    try {
      const outcome = await publishTarget(target, parent, token, pageTokens);
      if (outcome === "published") result.published++;
      else if (outcome === "failed") result.failed++;
      // "in_progress" (IG container pending / deferred) counts as neither yet.
    } catch (err) {
      await safeHandleError(target, err);
      result.failed++;
    }
  }

  await rollupParents();
  return result;
}

// ---------------------------------------------------------------------------
// Step A — resume in-flight IG containers
// ---------------------------------------------------------------------------

async function resumeIgContainers(token: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.postTargets)
    .where(
      and(
        eq(schema.postTargets.status, "publishing"),
        eq(schema.postTargets.platform, "instagram"),
        sql`${schema.postTargets.igContainerId} IS NOT NULL`,
        sql`${schema.postTargets.igPublishStartedAt} IS NULL`
      )
    )
    .limit(20);

  let count = 0;
  for (const t of rows) {
    try {
      const [parent] = await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, t.postId)).limit(1);
      if (!parent) continue;
      const resolved = await resolveAccount(t.clientId, "instagram");
      if ("reason" in resolved) {
        await terminalFail(t, "token_invalid", resolved.reason);
        continue;
      }
      const status = await getIgContainerStatus(t.igContainerId!, token);
      if (status.status === "FINISHED") {
        if (await applyQcGate(t, parent)) continue;
        if (await publishIgContainerOnce(t, resolved.account.externalId, t.igContainerId!, token)) count++;
      } else if (status.status === "PUBLISHED") {
        await recordPublished(t, t.igContainerId!, null);
        count++;
      } else if (status.status === "ERROR" || status.status === "EXPIRED") {
        await terminalFail(t, "media_error", `IG container ${status.status}: ${status.detail || ""}`);
      }
      // IN_PROGRESS → leave for the next run.
    } catch (err) {
      await safeHandleError(t, err);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Step B — sweep stuck / ambiguous rows (hard-fail, never resubmit)
// ---------------------------------------------------------------------------

async function sweepStuck(dryRun: boolean): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000);
  // publishing rows past the cutoff whose outcome is unknowable:
  //  - no container id (FB single-shot, or IG died before container), OR
  //  - publish already started but no external id recorded.
  const rows = await db
    .select()
    .from(schema.postTargets)
    .where(
      and(
        eq(schema.postTargets.status, "publishing"),
        sql`${schema.postTargets.claimedAt} < ${cutoff.toISOString()}`,
        sql`${schema.postTargets.externalPostId} IS NULL`,
        sql`(${schema.postTargets.igContainerId} IS NULL OR ${schema.postTargets.igPublishStartedAt} IS NOT NULL)`
      )
    )
    .limit(50);

  if (dryRun) return rows.length;

  for (const t of rows) {
    await terminalFail(
      t,
      "ambiguous_stuck",
      "Publish outcome unknown (timed out mid-request). Check the page manually, then Retry or mark published."
    );
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Step C — atomic claim of due targets
// ---------------------------------------------------------------------------

const DUE_TARGETS = sql`
  pt.status = 'pending'
  AND pt.enabled
  AND p.status IN ('scheduled', 'publishing')
  AND p.scheduled_at <= now()
  AND (pt.next_attempt_at IS NULL OR pt.next_attempt_at <= now())
`;

async function countDueTargets(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n FROM post_targets pt
    JOIN scheduled_posts p ON p.id = pt.post_id
    WHERE ${DUE_TARGETS}
  `);
  return (rows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}

async function claimDueTargets(): Promise<{ target: Target; parent: Parent }[]> {
  const claimed = await db.execute(sql`
    UPDATE post_targets SET
      status = 'publishing',
      claimed_at = now(),
      attempt_count = attempt_count + 1,
      updated_at = now()
    WHERE id IN (
      SELECT pt.id FROM post_targets pt
      JOIN scheduled_posts p ON p.id = pt.post_id
      WHERE ${DUE_TARGETS}
      ORDER BY p.scheduled_at ASC
      LIMIT ${CLAIM_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, post_id
  `);

  const rows = claimed as unknown as Array<{ id: string; post_id: string }>;
  if (!rows.length) return [];

  const targetIds = rows.map((r) => r.id);
  const parentIds = [...new Set(rows.map((r) => r.post_id))];

  const [targets, parents] = await Promise.all([
    db.select().from(schema.postTargets).where(inArray(schema.postTargets.id, targetIds)),
    db.select().from(schema.scheduledPosts).where(inArray(schema.scheduledPosts.id, parentIds)),
  ]);
  const parentById = new Map(parents.map((p) => [p.id, p]));

  // Flip touched parents to publishing.
  await db
    .update(schema.scheduledPosts)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(and(inArray(schema.scheduledPosts.id, parentIds), eq(schema.scheduledPosts.status, "scheduled")));

  return targets
    .map((t) => ({ target: t, parent: parentById.get(t.postId)! }))
    .filter((x) => x.parent);
}

/** Hand claimed-but-unstarted targets back to the queue without spending an attempt. */
async function releaseClaims(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db
    .update(schema.postTargets)
    .set({ status: "pending", claimedAt: null, attemptCount: sql`greatest(attempt_count - 1, 0)`, updatedAt: new Date() })
    .where(and(inArray(schema.postTargets.id, ids), eq(schema.postTargets.status, "publishing")));
}

// ---------------------------------------------------------------------------
// Step D — publish one claimed target
// ---------------------------------------------------------------------------

async function publishTarget(
  t: Target,
  parent: Parent,
  token: string,
  pageTokens: Map<string, string>
): Promise<Outcome> {
  const held = await applyQcGate(t, parent);
  if (held) return held;

  const resolved = await resolveAccount(t.clientId, t.platform);
  if ("reason" in resolved) {
    await terminalFail(t, "token_invalid", resolved.reason);
    return "failed";
  }
  const { account } = resolved;

  const text = composePublishText(t.caption, (t.hashtags as string[]) || []);
  const imageUrl = t.mediaOverrideUrl || toExternalUrl(parent.mediaUrl);

  // v1 = images only. Videos are queued but held until v1.1.
  if (parent.mediaType === "video") {
    await terminalFail(t, "media_error", "Video publishing not yet enabled (coming in v1.1)");
    return "failed";
  }

  if (t.platform === "facebook") {
    const pageToken = await pageTokenFor(account.externalId, token, pageTokens);
    const { postId } = await attemptPublish("Facebook", () =>
      publishPagePhoto(account.externalId, { imageUrl, message: text, token: pageToken })
    );
    await recordPublished(t, postId, await getPermalink(postId, pageToken, "fb"));
    return "published";
  }

  // Instagram
  // Quota guard — defer (not fail) if we're near the 24h limit.
  const limit = await getIgPublishingLimit(account.externalId, token);
  if (limit.usage >= IG_QUOTA_GUARD) {
    await db
      .update(schema.postTargets)
      .set({
        status: "pending",
        claimedAt: null,
        attemptCount: sql`attempt_count - 1`,
        nextAttemptAt: new Date(Date.now() + 60 * 60_000),
        errorCode: "quota_exceeded",
        errorMessage: `IG daily publishing limit near (${limit.usage}/${limit.total}) — deferred 1h`,
        updatedAt: new Date(),
      })
      .where(eq(schema.postTargets.id, t.id));
    return "in_progress";
  }

  // Reuse the container from an earlier attempt instead of creating a second one.
  let containerId = t.igContainerId;
  if (containerId) {
    const existing = await getIgContainerStatus(containerId, token);
    if (existing.status === "PUBLISHED") {
      await recordPublished(t, containerId, null);
      return "published";
    }
    if (existing.status === "FINISHED") {
      return (await publishIgContainerOnce(t, account.externalId, containerId, token)) ? "published" : "in_progress";
    }
    if (existing.status === "ERROR" || existing.status === "EXPIRED") containerId = null;
    // IN_PROGRESS → poll it below.
  }

  if (!containerId) {
    const mediaType = t.placement === "story" ? "STORIES" : "IMAGE";
    const created = await createIgContainer(account.externalId, {
      imageUrl: await igJpegUrl(t, parent, imageUrl),
      caption: t.placement === "story" ? undefined : text,
      mediaType,
      token,
    });
    containerId = created.containerId;
    if (!containerId) {
      throw new MetaGraphError("Instagram returned no media container id", { code: "unknown", httpStatus: 200 });
    }
    await db
      .update(schema.postTargets)
      .set({ igContainerId: containerId, igPublishStartedAt: null, updatedAt: new Date() })
      .where(eq(schema.postTargets.id, t.id));
  }

  // In-run poll for a short while; else leave for Step A next run.
  for (let i = 0; i < IG_INRUN_POLL_TRIES; i++) {
    await sleep(IG_INRUN_POLL_MS);
    const status = await getIgContainerStatus(containerId, token);
    if (status.status === "FINISHED") {
      return (await publishIgContainerOnce(t, account.externalId, containerId, token)) ? "published" : "in_progress";
    }
    if (status.status === "ERROR" || status.status === "EXPIRED") {
      await terminalFail(t, "media_error", `IG container ${status.status}: ${status.detail || ""}`);
      return "failed";
    }
  }
  // Still processing — remains 'publishing' with a container id; Step A resumes it.
  return "in_progress";
}

/**
 * Re-check the source's Quality Control verdict before anything goes live. A pending
 * re-check defers the target; a hold fails it with the reason. Returns null when clear.
 */
async function applyQcGate(t: Target, parent: Parent): Promise<Outcome | null> {
  const check = await recheckSourceForPublish(parent);
  if (check.ok) return null;
  if (check.retryLater) {
    await db
      .update(schema.postTargets)
      .set({
        status: "pending",
        claimedAt: null,
        attemptCount: sql`greatest(attempt_count - 1, 0)`,
        nextAttemptAt: new Date(Date.now() + QC_RECHECK_DELAY_MS),
        errorCode: "qc_pending",
        errorMessage: check.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.postTargets.id, t.id));
    return "in_progress";
  }
  await terminalFail(t, "qc_held", check.reason);
  return "failed";
}

/**
 * Instagram content publishing accepts JPEG only. Posts queued before every IG target got
 * its own JPEG variant still point at a PNG, so convert (once) instead of failing them.
 */
async function igJpegUrl(t: Target, parent: Parent, imageUrl: string): Promise<string> {
  let path = "";
  try {
    path = new URL(imageUrl).pathname;
  } catch {
    // unparseable → convert
  }
  if (/\.jpe?g$/i.test(path)) return imageUrl;

  const storageBase = (await getClientStoragePrefix(t.clientId)) || `brands/${BRAND_SLUG}`;
  const jpeg = await makeIgVariant({ sourceUrl: t.mediaOverrideUrl || parent.mediaUrl, storageBase, postId: parent.id, crop: false });
  await db
    .update(schema.postTargets)
    .set({ mediaOverrideUrl: jpeg, updatedAt: new Date() })
    .where(eq(schema.postTargets.id, t.id));
  return jpeg;
}

async function pageTokenFor(pageId: string, token: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(pageId);
  if (cached) return cached;
  const pageToken = await getPageAccessToken(pageId, token);
  cache.set(pageId, pageToken);
  return pageToken;
}

/**
 * Make the one call that makes a post visible. Errors Meta returns before acting (auth,
 * permission, rate limit, bad media) are definitive and keep their normal routing; a
 * network drop or 5xx may have published, so it becomes AmbiguousPublishError.
 */
async function attemptPublish<T>(label: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof MetaGraphError && err.code !== "unknown") throw err;
    throw new AmbiguousPublishError(
      `${label} did not confirm the publish (${errMessage(err)}) — it may have gone live. Check the account, then Retry or Mark published.`
    );
  }
}

/**
 * media_publish exactly once per container: ig_publish_started_at is taken atomically, so
 * overlapping runs can never both publish. Returns false if another run holds the fence.
 */
async function publishIgContainerOnce(t: Target, igUserId: string, containerId: string, token: string): Promise<boolean> {
  const fenced = await db
    .update(schema.postTargets)
    .set({ igPublishStartedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.postTargets.id, t.id), isNull(schema.postTargets.igPublishStartedAt)))
    .returning({ id: schema.postTargets.id });
  if (!fenced.length) return false;

  const { mediaId } = await attemptPublish("Instagram", () => publishIgContainer(igUserId, containerId, token));
  await recordPublished(t, mediaId, await getPermalink(mediaId, token, "ig"));
  return true;
}

/** Record a confirmed publish. The post is live, so a failure here must never lead to a retry. */
async function recordPublished(t: Target, externalId: string, permalink: string | null): Promise<void> {
  if (!externalId) {
    throw new AmbiguousPublishError("Meta accepted the publish but returned no id — check the account, then Mark published.");
  }
  try {
    await markPublished(t, externalId, permalink);
  } catch (err) {
    throw new AmbiguousPublishError(`Published, but recording it failed (${errMessage(err)}) — Mark published.`);
  }
}

// ---------------------------------------------------------------------------
// Step E — roll parent status up from targets
// ---------------------------------------------------------------------------

async function rollupParents(): Promise<void> {
  // Parents in 'publishing' whose targets are all terminal (or skipped).
  const parents = await db
    .select()
    .from(schema.scheduledPosts)
    .where(eq(schema.scheduledPosts.status, "publishing"))
    .limit(200);

  for (const p of parents) {
    const targets = await db
      .select()
      .from(schema.postTargets)
      .where(and(eq(schema.postTargets.postId, p.id), eq(schema.postTargets.enabled, true)));
    if (!targets.length) continue;

    const allTerminal = targets.every((t) => ["published", "failed", "skipped"].includes(t.status));
    if (!allTerminal) continue;

    const anyPublished = targets.some((t) => t.status === "published");
    const anyFailed = targets.some((t) => t.status === "failed");
    const status = anyPublished ? (anyFailed ? "partial" : "published") : "failed";
    await db
      .update(schema.scheduledPosts)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, p.id));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveAccount(clientId: string, platform: string): Promise<{ account: Account } | { reason: string }> {
  const [a] = await db
    .select()
    .from(schema.socialAccounts)
    .where(
      and(
        eq(schema.socialAccounts.clientId, clientId),
        eq(schema.socialAccounts.platform, platform),
        eq(schema.socialAccounts.enabled, true)
      )
    )
    .limit(1);
  if (!a) return { reason: `No connected ${platform} account for this brand — connect it under Post Scheduler → Accounts.` };
  if (a.health === "token_invalid") {
    return { reason: `Meta rejected the token for this ${platform} account — re-test it under Accounts. ${a.healthError || ""}`.trim() };
  }
  return { account: a };
}

async function markPublished(t: Target, externalId: string, permalink: string | null): Promise<void> {
  await db
    .update(schema.postTargets)
    .set({
      status: "published",
      externalPostId: externalId,
      externalPermalink: permalink,
      publishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.postTargets.id, t.id));
}

async function terminalFail(t: Target, code: string, message: string): Promise<void> {
  await db
    .update(schema.postTargets)
    .set({ status: "failed", errorCode: code, errorMessage: message, updatedAt: new Date() })
    .where(eq(schema.postTargets.id, t.id));
}

/** handleError, but a DB failure while recording one target never aborts the whole run. */
async function safeHandleError(t: Target, err: unknown): Promise<void> {
  try {
    await handleError(t, err);
  } catch (e) {
    // The row stays 'publishing'; Step B settles it on a later run.
    console.error(`[posting/publish] could not record the error for target ${t.id}:`, e, "original:", err);
  }
}

/** Error routing: retry (backoff) vs terminal vs account-health flag. */
async function handleError(t: Target, err: unknown): Promise<void> {
  if (err instanceof AmbiguousPublishError) {
    await terminalFail(t, "ambiguous_stuck", err.message);
    return;
  }

  const code = err instanceof MetaGraphError ? err.code : "unknown";
  const message = errMessage(err);

  if (code === "token_invalid") {
    await terminalFail(t, "token_invalid", message);
    await db
      .update(schema.socialAccounts)
      .set({ health: "token_invalid", healthError: message, healthCheckedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.socialAccounts.clientId, t.clientId), eq(schema.socialAccounts.platform, t.platform)));
    return;
  }
  if (code === "permission_denied") {
    const readable = `Meta refused permission to publish to this ${t.platform} account — in Business Settings, assign it to the System User with publishing permission, then Test it under Accounts and Retry. (Meta: ${message})`;
    await terminalFail(t, "permission_denied", readable);
    await db
      .update(schema.socialAccounts)
      .set({ health: "error", healthError: readable, healthCheckedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.socialAccounts.clientId, t.clientId), eq(schema.socialAccounts.platform, t.platform)));
    return;
  }
  if (code === "media_error") {
    await terminalFail(t, "media_error", message);
    return;
  }
  // rate_limited / quota_exceeded / unknown → retryable with backoff.
  const attempt = t.attemptCount; // already incremented at claim time
  if (attempt >= MAX_ATTEMPTS) {
    await terminalFail(t, code, `${message} (max attempts reached)`);
    return;
  }
  const backoffMs = 15 * 60_000 * attempt;
  await db
    .update(schema.postTargets)
    .set({
      status: "pending",
      claimedAt: null,
      nextAttemptAt: new Date(Date.now() + backoffMs),
      // Anything that could have published was converted to AmbiguousPublishError above,
      // so a retryable error here means media_publish did not happen — release the fence.
      igPublishStartedAt: null,
      errorCode: code,
      errorMessage: message,
      updatedAt: new Date(),
    })
    .where(eq(schema.postTargets.id, t.id));
}
