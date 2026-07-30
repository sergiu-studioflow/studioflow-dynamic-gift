/**
 * One-click rollback: restore a brand's live prompts from a prior published job.
 *
 * The safety net for publishing. A published draft that turns out worse in
 * practice is reversible without anyone hand-editing a FIXED prompt.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { rollbackToJob } from "@/lib/static-ads/prompt-builder/job-runner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/** POST { jobId } — restore the brand's live prompts from a prior published job. */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { slug } = await params;
  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);
  if (!client) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const ok = await rollbackToJob(client.id, jobId);
  if (!ok) return NextResponse.json({ error: "Job has no prompts to restore" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
