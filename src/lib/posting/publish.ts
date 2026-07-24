/**
 * Publisher engine — runs inside /api/cron/publish-posts (one cron does all).
 *
 * Order per invocation:
 *   A. Resume in-flight IG containers (safe — creating a container publishes nothing).
 *   B. Sweep stuck/ambiguous rows (hard-fail, never auto-resubmit a single-shot post).
 *   C. Atomically claim due targets (UPDATE ... FOR UPDATE SKIP LOCKED).
 *   D. Publish each claimed target (FB photo / IG container→publish).
 *   E. Roll parent status up from its targets.
 *
 * Idempotency: atomic claims (no double-worker), pre-call claim stamps, external
 * ids recorded with the published status, ambiguous rows surfaced to humans.
 */

import { db, schema } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getApiKey } from "@/lib/api-keys";
import { toExternalUrl } from "@/lib/r2";
import { composePublishText } from "./platforms";
import {
  MetaGraphError,
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

type Target = typeof schema.postTargets.$inferSelect;
type Parent = typeof schema.scheduledPosts.$inferSelect;
type Account = typeof schema.socialAccounts.$inferSelect;

export type PublishRunResult = {
  resumed: number;
  stuckFailed: number;
  claimed: number;
  published: number;
  failed: number;
  dryRun: boolean;
  note?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runPublisher(opts: { dryRun?: boolean } = {}): Promise<PublishRunResult> {
  const dryRun = !!opts.dryRun;
  const result: PublishRunResult = { resumed: 0, stuckFailed: 0, claimed: 0, published: 0, failed: 0, dryRun };

  const token = (await getApiKey("META_SYSTEM_USER_TOKEN")).trim();

  // Step B always runs (DB-only). Steps A/C/D need a token.
  result.stuckFailed = await sweepStuck();

  if (!token) {
    result.note = "META_SYSTEM_USER_TOKEN not configured — publishing skipped.";
    await rollupParents();
    return result;
  }

  result.resumed = await resumeIgContainers(token, dryRun);

  const claimed = await claimDueTargets(dryRun);
  result.claimed = claimed.length;

  for (const { target, parent } of claimed) {
    try {
      const outcome = await publishTarget(target, parent, token, dryRun);
      if (outcome === "published") result.published++;
      else if (outcome === "failed") result.failed++;
      // "in_progress" (IG container pending) counts as neither yet.
    } catch (err) {
      await handleError(target, err);
      result.failed++;
    }
  }

  await rollupParents();
  return result;
}

// ---------------------------------------------------------------------------
// Step A — resume in-flight IG containers
// ---------------------------------------------------------------------------

async function resumeIgContainers(token: string, dryRun: boolean): Promise<number> {
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
    if (dryRun) continue;
    try {
      const account = await resolveAccount(t.clientId, "instagram");
      if (!account) {
        await terminalFail(t, "token_invalid", "No connected Instagram account");
        continue;
      }
      const status = await getIgContainerStatus(t.igContainerId!, token);
      if (status.status === "FINISHED") {
        await db
          .update(schema.postTargets)
          .set({ igPublishStartedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.postTargets.id, t.id));
        const { mediaId } = await publishIgContainer(account.externalId, t.igContainerId!, token);
        const permalink = await getPermalink(mediaId, token, "ig");
        await markPublished(t, mediaId, permalink);
        count++;
      } else if (status.status === "ERROR" || status.status === "EXPIRED") {
        await terminalFail(t, "media_error", `IG container ${status.status}: ${status.detail || ""}`);
      }
      // IN_PROGRESS → leave for the next run.
    } catch (err) {
      await handleError(t, err);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Step B — sweep stuck / ambiguous rows (hard-fail, never resubmit)
// ---------------------------------------------------------------------------

async function sweepStuck(): Promise<number> {
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

async function claimDueTargets(dryRun: boolean): Promise<{ target: Target; parent: Parent }[]> {
  const claimed = await db.execute(sql`
    UPDATE post_targets SET
      status = 'publishing',
      claimed_at = now(),
      attempt_count = attempt_count + 1,
      updated_at = now()
    WHERE id IN (
      SELECT pt.id FROM post_targets pt
      JOIN scheduled_posts p ON p.id = pt.post_id
      WHERE pt.status = 'pending'
        AND pt.enabled
        AND p.status IN ('scheduled', 'publishing')
        AND p.scheduled_at <= now()
        AND (pt.next_attempt_at IS NULL OR pt.next_attempt_at <= now())
      ORDER BY p.scheduled_at ASC
      LIMIT ${CLAIM_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, post_id
  `);

  const rows = claimed as unknown as Array<{ id: string; post_id: string }>;
  if (!rows.length) return [];

  if (dryRun) {
    // Revert claims — dry run must not mutate live queue state.
    await db
      .update(schema.postTargets)
      .set({ status: "pending", claimedAt: null, attemptCount: sql`attempt_count - 1`, updatedAt: new Date() })
      .where(inArray(schema.postTargets.id, rows.map((r) => r.id)));
    return [];
  }

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

// ---------------------------------------------------------------------------
// Step D — publish one claimed target
// ---------------------------------------------------------------------------

async function publishTarget(
  t: Target,
  parent: Parent,
  token: string,
  dryRun: boolean
): Promise<"published" | "failed" | "in_progress"> {
  if (dryRun) return "in_progress";

  const account = await resolveAccount(t.clientId, t.platform);
  if (!account) {
    await terminalFail(t, "token_invalid", `No connected ${t.platform} account`);
    return "failed";
  }

  const text = composePublishText(t.caption, (t.hashtags as string[]) || []);
  const imageUrl = t.mediaOverrideUrl || toExternalUrl(parent.mediaUrl);

  // v1 = images only. Videos are queued but held until v1.1.
  if (parent.mediaType === "video") {
    await terminalFail(t, "media_error", "Video publishing not yet enabled (coming in v1.1)");
    return "failed";
  }

  if (t.platform === "facebook") {
    const { postId } = await publishPagePhoto(account.externalId, { imageUrl, message: text, token });
    const permalink = await getPermalink(postId, token, "fb");
    await markPublished(t, postId, permalink);
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

  const mediaType = t.placement === "story" ? "STORIES" : "IMAGE";
  const { containerId } = await createIgContainer(account.externalId, {
    imageUrl,
    caption: t.placement === "story" ? undefined : text,
    mediaType,
    token,
  });
  await db
    .update(schema.postTargets)
    .set({ igContainerId: containerId, updatedAt: new Date() })
    .where(eq(schema.postTargets.id, t.id));

  // In-run poll for a short while; else leave for Step A next run.
  for (let i = 0; i < IG_INRUN_POLL_TRIES; i++) {
    await sleep(IG_INRUN_POLL_MS);
    const status = await getIgContainerStatus(containerId, token);
    if (status.status === "FINISHED") {
      await db
        .update(schema.postTargets)
        .set({ igPublishStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.postTargets.id, t.id));
      const { mediaId } = await publishIgContainer(account.externalId, containerId, token);
      const permalink = await getPermalink(mediaId, token, "ig");
      await markPublished(t, mediaId, permalink);
      return "published";
    }
    if (status.status === "ERROR" || status.status === "EXPIRED") {
      await terminalFail(t, "media_error", `IG container ${status.status}: ${status.detail || ""}`);
      return "failed";
    }
  }
  // Still processing — remains 'publishing' with a container id; Step A resumes it.
  return "in_progress";
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

async function resolveAccount(clientId: string, platform: string): Promise<Account | null> {
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
  if (!a) return null;
  if (a.health === "token_invalid") return null;
  return a;
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

/** Error routing: retry (backoff) vs terminal vs account-health flag. */
async function handleError(t: Target, err: unknown): Promise<void> {
  const code = err instanceof MetaGraphError ? err.code : "unknown";
  const message = err instanceof Error ? err.message : String(err);

  if (code === "token_invalid") {
    await terminalFail(t, "token_invalid", message);
    await db
      .update(schema.socialAccounts)
      .set({ health: "token_invalid", healthError: message, healthCheckedAt: new Date(), updatedAt: new Date() })
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
      errorCode: code,
      errorMessage: message,
      updatedAt: new Date(),
    })
    .where(eq(schema.postTargets.id, t.id));
}
