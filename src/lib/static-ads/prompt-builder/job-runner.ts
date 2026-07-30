/**
 * Static-Ad Prompt Builder — job runner + reviewed publish.
 *
 * Bridges the pure pipeline (index.ts) to the DB job row + clientStaticAdConfig.
 * `executePromptJob(jobId)` runs the full build, checkpoints stage progress, and
 * parks the drafts at `awaiting_review`. It NEVER writes the live prompts —
 * `publishJob()` does, and only from the admin approve route, after a human has
 * read both drafts and the critic report. Agent 1/2 prompts are FIXED per brand;
 * reviewed publishing is the single sanctioned way they change.
 *
 * On ContractError (a draft that would break the runtime) the job is marked
 * `error` and whatever the brand already had stays in place.
 */

import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { ContractError, runFullBuild, type BuildContext } from "./index";
import type { BrandType, Stage } from "./types";
import { pickReferenceForClient } from "@/lib/static-ads/reference-selection";

/** Assemble the pipeline input from a client's DB record + products. */
export async function buildContextForClient(clientId: string): Promise<BuildContext> {
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  if (!client) throw new Error(`Client ${clientId} not found`);

  const settings = (client.settings ?? {}) as {
    brandType?: BrandType;
    staticAdReferenceUrls?: string[];
    brandGuidelines?: BuildContext["guidelines"];
  };

  const products = await db
    .select()
    .from(schema.clientProducts)
    .where(eq(schema.clientProducts.clientId, clientId));

  // Brand intelligence the agency already wrote — grounds research + voice.
  const intelRows = await db
    .select({ sectionType: schema.clientBrandIntelligence.sectionType, content: schema.clientBrandIntelligence.content })
    .from(schema.clientBrandIntelligence)
    .where(eq(schema.clientBrandIntelligence.clientId, clientId));
  const intel: Record<string, string> = {};
  for (const r of intelRows) {
    if (r.sectionType && r.content && r.content.trim()) intel[r.sectionType] = r.content.trim();
  }

  // Structured USPs the agency wrote — folded into the voice/USP context so the
  // authored prompts speak in claims the brand already stands behind.
  const uspRows = await db
    .select({ text: schema.clientUsps.uspText, category: schema.clientUsps.uspCategory, isPrimary: schema.clientUsps.isPrimary })
    // The donor filters on a `useInStatics` flag; this portal's client_usps has
    // no such column, so every USP is in scope.
    .from(schema.clientUsps)
    .where(eq(schema.clientUsps.clientId, clientId));
  const uspList = uspRows
    .filter((u) => u.text && u.text.trim())
    .map((u) => `- ${u.text!.trim()}${u.isPrimary ? " (primary)" : ""}${u.category ? ` [${u.category}]` : ""}`)
    .join("\n");
  const mergedUsps = [intel.usps, uspList].filter((s) => s && s.trim()).join("\n\n") || null;

  // Reference ad for the hard output-contract test. Prefer whatever the agency
  // pinned for this brand; otherwise draw one the way the generator itself
  // would (own winners → own references → industry → shared pool), so the test
  // runs against an image this brand will actually be handed. Without any
  // reference the contract check degrades to a weak regex, so this matters.
  const configured = Array.isArray(settings.staticAdReferenceUrls) ? settings.staticAdReferenceUrls : [];
  let referenceUrls = configured;
  if (!referenceUrls.length) {
    const picked = await pickReferenceForClient(clientId, { includeWinners: true });
    if (picked?.imageUrl) referenceUrls = [picked.imageUrl];
  }

  // Drop obvious placeholder/test products so they never reach the catalog.
  const PLACEHOLDER_NAME = /^(test|placeholder|demo|sample|untitled|example)\b/i;

  return {
    brandName: client.brandName,
    website: client.website,
    brandType: settings.brandType === "services" ? "services" : "products",
    vertical: client.category, // brands.category is this portal's vertical/industry
    brandColor: client.brandColor,
    logoUrl: client.logoUrl,
    referenceUrls,
    guidelines: settings.brandGuidelines ?? null,
    brandIntel: {
      identity: intel.identity ?? null,
      audience: intel.audience ?? null,
      usps: mergedUsps,
      voice: intel.voice ?? null,
      constraints: intel.constraints ?? null,
    },
    items: products
      .filter((p) => p.productName && !PLACEHOLDER_NAME.test(p.productName.trim()))
      .map((p) => ({
        name: p.productName,
        imageUrl: p.imageUrl,
        sourceUrl: p.productUrl,
        benefits: p.keyBenefits,
      })),
  };
}

async function setJob(jobId: string, fields: Partial<typeof schema.clientStaticAdPromptJobs.$inferInsert>) {
  await db
    .update(schema.clientStaticAdPromptJobs)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(schema.clientStaticAdPromptJobs.id, jobId));
}

/**
 * Run a prompt-build job end to end. Idempotent-ish: only acts on `pending`
 * jobs (re-running a published/errored job is a no-op). Designed to be called
 * from Next.js `after()` so the HTTP response returns immediately.
 */
export async function executePromptJob(jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(schema.clientStaticAdPromptJobs)
    .where(eq(schema.clientStaticAdPromptJobs.id, jobId))
    .limit(1);

  if (!job || job.status !== "pending") return;

  await setJob(jobId, {
    status: "running",
    startedAt: new Date(),
    stage: "research",
    // Counted on start, not on success — a job that dies without ever writing a
    // terminal status is exactly the case the sweep's retry cap has to bound.
    attempts: (job.attempts ?? 0) + 1,
  });

  try {
    const ctx = await buildContextForClient(job.clientId);
    const result = await runFullBuild(ctx, {
      onStage: async (stage: Stage) => {
        await setJob(jobId, { stage });
      },
    });

    // Draft-and-review: store the drafts and AWAIT admin approval. Nothing is
    // written to clientStaticAdConfig until publishJob() runs from the approve
    // route — so a less-than-perfect run never silently overwrites the live
    // (placeholder or manual) prompts. The contract test already ran inside
    // runFullBuild, so anything reaching here is runtime-valid.
    await setJob(jobId, {
      status: "awaiting_review",
      stage: "critique",
      agent1Prompt: result.agent1Prompt,
      agent2Prompt: result.agent2Prompt,
      brandDna: result.brandDna as unknown as object,
      criticReport: result.criticReport as unknown as object,
      completedAt: new Date(),
    });
  } catch (err) {
    const isContract = err instanceof ContractError;
    const message = err instanceof Error ? err.message : String(err);
    await setJob(jobId, {
      status: "error",
      errorMessage: isContract
        ? `Output contract failed — the draft would break the runtime, so nothing was published: ${message}`
        : message,
      completedAt: new Date(),
    });
  }
}

/**
 * Publish an awaiting-review job: write its drafts to clientStaticAdConfig, flip
 * the placeholder flag, store the Brand DNA section, mark the job published.
 * Called from the admin approve route. Atomic.
 */
export async function publishJob(clientId: string, jobId: string): Promise<boolean> {
  const [job] = await db
    .select()
    .from(schema.clientStaticAdPromptJobs)
    .where(and(eq(schema.clientStaticAdPromptJobs.id, jobId), eq(schema.clientStaticAdPromptJobs.clientId, clientId)))
    .limit(1);
  if (!job || !job.agent1Prompt || !job.agent2Prompt) return false;
  if (job.status !== "awaiting_review" && job.status !== "published") return false;

  const dna = (job.brandDna ?? null) as { document?: string } | null;

  // Publishing is the ONLY sanctioned writer of agent1Prompt/agent2Prompt: a
  // human reviews the draft and approves it. Everything else treats those
  // columns as fixed. Atomic, so a mid-write failure can never leave a brand
  // with one new prompt and one old one.
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.clientStaticAdConfig)
      .values({ clientId, agent1Prompt: job.agent1Prompt!, agent2Prompt: job.agent2Prompt! })
      .onConflictDoUpdate({
        target: schema.clientStaticAdConfig.clientId,
        set: { agent1Prompt: job.agent1Prompt!, agent2Prompt: job.agent2Prompt!, updatedAt: new Date() },
      });

    const [client] = await tx
      .select({ settings: schema.clients.settings })
      .from(schema.clients)
      .where(eq(schema.clients.id, clientId))
      .limit(1);
    await tx
      .update(schema.clients)
      .set({
        settings: { ...((client?.settings as Record<string, unknown>) ?? {}), staticAdPromptsArePlaceholder: false },
        updatedAt: new Date(),
      })
      .where(eq(schema.clients.id, clientId));

    if (dna?.document) {
      const [existingDna] = await tx
        .select({ id: schema.clientBrandIntelligence.id })
        .from(schema.clientBrandIntelligence)
        .where(
          and(
            eq(schema.clientBrandIntelligence.clientId, clientId),
            eq(schema.clientBrandIntelligence.sectionType, "brand_dna"),
          ),
        )
        .limit(1);
      if (existingDna) {
        await tx
          .update(schema.clientBrandIntelligence)
          .set({ content: dna.document, updatedAt: new Date() })
          .where(eq(schema.clientBrandIntelligence.id, existingDna.id));
      } else {
        await tx.insert(schema.clientBrandIntelligence).values({
          clientId,
          title: "Brand DNA (auto-generated)",
          content: dna.document,
          sectionType: "brand_dna",
          sortOrder: 8,
        });
      }
    }

    await tx
      .update(schema.clientStaticAdPromptJobs)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.clientStaticAdPromptJobs.id, jobId));
  });

  try {
    await db.insert(schema.activityLog).values({
      userId: job.triggeredBy ?? null,
      clientId,
      action: "static_ad_prompts_published",
      resourceType: "client_static_ad_config",
      resourceId: clientId,
      details: { jobId },
    });
  } catch {
    /* ignore */
  }
  return true;
}

/** Mark an awaiting-review job rejected (does not touch live prompts). */
export async function rejectJob(clientId: string, jobId: string): Promise<boolean> {
  // .returning() so a wrong jobId / wrong brand is a real 404 rather than a
  // cheerful `ok: true` over a zero-row update.
  const rows = await db
    .update(schema.clientStaticAdPromptJobs)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(schema.clientStaticAdPromptJobs.id, jobId), eq(schema.clientStaticAdPromptJobs.clientId, clientId)))
    .returning({ id: schema.clientStaticAdPromptJobs.id });
  return rows.length > 0;
}

/**
 * Roll a client's live prompts back to a prior published job's drafts.
 * Used by the admin UI's one-click rollback.
 */
export async function rollbackToJob(clientId: string, jobId: string): Promise<boolean> {
  const [job] = await db
    .select()
    .from(schema.clientStaticAdPromptJobs)
    .where(and(eq(schema.clientStaticAdPromptJobs.id, jobId), eq(schema.clientStaticAdPromptJobs.clientId, clientId)))
    .limit(1);
  if (!job || !job.agent1Prompt || !job.agent2Prompt) return false;

  await db
    .insert(schema.clientStaticAdConfig)
    .values({ clientId, agent1Prompt: job.agent1Prompt, agent2Prompt: job.agent2Prompt })
    .onConflictDoUpdate({
      target: schema.clientStaticAdConfig.clientId,
      set: { agent1Prompt: job.agent1Prompt, agent2Prompt: job.agent2Prompt, updatedAt: new Date() },
    });
  return true;
}
