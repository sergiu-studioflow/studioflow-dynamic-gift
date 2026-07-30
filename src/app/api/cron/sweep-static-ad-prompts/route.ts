/**
 * Backstop for the prompt-generation pipeline.
 *
 * The happy path runs inline in the generate route's after() phase. This sweep
 * only handles the two ways that can fail:
 *   - a job wedged at `running` because the invocation died mid-build (deploy,
 *     timeout, cold-start eviction) — retried ONCE, then failed out, and
 *   - a job left at `pending` because after() never ran at all.
 *
 * Live prompts are never touched here: a failed job leaves whatever the brand
 * already had in place.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { executePromptJob } from "@/lib/static-ads/prompt-builder/job-runner";

export const dynamic = "force-dynamic";
// Matches the generate route: this can run one full build inline.
export const maxDuration = 800;

/** Attempts allowed per job before it is failed out for good. */
const MAX_ATTEMPTS = 2;

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedCron(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  // 15 min is comfortably past the 800s ceiling, so a job that is still
  // legitimately running is never reaped.
  const stuckCutoff = new Date(now - 15 * 60 * 1000);
  const pendingCutoff = new Date(now - 2 * 60 * 1000);

  // 1. Wedged `running` jobs: retry once by returning them to `pending`,
  //    otherwise fail them out.
  const requeued = await db
    .update(schema.clientStaticAdPromptJobs)
    .set({ status: "pending", stage: null, startedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.clientStaticAdPromptJobs.status, "running"),
        lt(schema.clientStaticAdPromptJobs.updatedAt, stuckCutoff),
        lt(schema.clientStaticAdPromptJobs.attempts, MAX_ATTEMPTS)
      )
    )
    .returning({ id: schema.clientStaticAdPromptJobs.id });

  const failed = await db
    .update(schema.clientStaticAdPromptJobs)
    .set({
      status: "error",
      errorMessage: `Timed out — no progress for 15+ minutes across ${MAX_ATTEMPTS} attempts. Existing prompts are untouched.`,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.clientStaticAdPromptJobs.status, "running"),
        lt(schema.clientStaticAdPromptJobs.updatedAt, stuckCutoff),
        sql`${schema.clientStaticAdPromptJobs.attempts} >= ${MAX_ATTEMPTS}`
      )
    )
    .returning({ id: schema.clientStaticAdPromptJobs.id });

  // 2. Run ONE orphaned pending job inline. One per tick: a build is a long,
  //    expensive invocation and this cron shares the */15 slot with four others.
  const [orphan] = await db
    .select({ id: schema.clientStaticAdPromptJobs.id })
    .from(schema.clientStaticAdPromptJobs)
    .where(
      and(
        eq(schema.clientStaticAdPromptJobs.status, "pending"),
        lt(schema.clientStaticAdPromptJobs.createdAt, pendingCutoff)
      )
    )
    .orderBy(schema.clientStaticAdPromptJobs.createdAt)
    .limit(1);

  let ranOrphan: string | null = null;
  if (orphan) {
    ranOrphan = orphan.id;
    await executePromptJob(orphan.id);
  }

  return NextResponse.json({
    ok: true,
    requeued: requeued.length,
    failed: failed.length,
    ranOrphan,
  });
}
