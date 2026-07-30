/**
 * Poll one build job, and approve/reject it.
 *
 * Approving is the ONLY sanctioned path that writes a brand's FIXED Agent 1/2
 * prompts — a human reads both drafts and the critic report first.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { publishJob, rejectJob } from "@/lib/static-ads/prompt-builder/job-runner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; jobId: string }> };

async function clientIdForSlug(slug: string) {
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);
  return client?.id ?? null;
}

/** GET — poll a single build job (scoped to the brand in the path, so no IDOR). */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { slug, jobId } = await params;

  const clientId = await clientIdForSlug(slug);
  if (!clientId) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const [job] = await db
    .select()
    .from(schema.clientStaticAdPromptJobs)
    .where(
      and(eq(schema.clientStaticAdPromptJobs.id, jobId), eq(schema.clientStaticAdPromptJobs.clientId, clientId))
    )
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    status: job.status,
    stage: job.stage,
    errorMessage: job.errorMessage,
    brandDna: job.brandDna ?? null,
    agent1Prompt: job.agent1Prompt ?? null,
    agent2Prompt: job.agent2Prompt ?? null,
    criticReport: job.criticReport ?? null,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    publishedAt: job.publishedAt,
    createdAt: job.createdAt,
  });
}

/** POST { action: "approve" | "reject" } — admin publishes or rejects a reviewed draft. */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { slug, jobId } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  const clientId = await clientIdForSlug(slug);
  if (!clientId) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  if (action === "approve") {
    const ok = await publishJob(clientId, jobId);
    if (!ok) return NextResponse.json({ error: "Job is not in a publishable state" }, { status: 400 });
    return NextResponse.json({ ok: true, status: "published" });
  }
  if (action === "reject") {
    const ok = await rejectJob(clientId, jobId);
    if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ ok: true, status: "rejected" });
  }
  return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
}
