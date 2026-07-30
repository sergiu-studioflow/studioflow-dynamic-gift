/**
 * Static-Ad Prompt Builder — status + enqueue.
 *
 * A brand cannot use the Static Ad System until it has a brand-specific Agent 1
 * and Agent 2 prompt. Authoring those by hand is a multi-hour strategist job, so
 * a new brand (The Cap Company) sat unusable. This endpoint drafts them.
 *
 * Drafts only: nothing here writes the live prompts. The build parks at
 * `awaiting_review` and an admin publishes it from the [jobId] route.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { executePromptJob } from "@/lib/static-ads/prompt-builder/job-runner";

export const dynamic = "force-dynamic";
// The build runs in this invocation's after() phase. The pipeline is ~4-8 min
// (a web-search research call, a vibe call, one study call per product, two
// contract calls, one critic call), so it needs the Fluid Compute ceiling —
// the rest of this portal's routes cap at 300s because nothing else runs a
// multi-call research pipeline inline.
export const maxDuration = 800;

type Params = { params: Promise<{ slug: string }> };

async function resolveClient(slug: string) {
  const [client] = await db
    .select({
      id: schema.clients.id,
      settings: schema.clients.settings,
      // This portal has no `clients.vertical` column — the vertical lives in
      // brands.category. (The donor portal wrote a `vertical` column that does
      // not exist there either; that latent bug is corrected here.)
      vertical: schema.clients.category,
    })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);
  return client;
}

/** GET — current prompt status + recent build jobs. */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { slug } = await params;
  const client = await resolveClient(slug);
  if (!client) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const settings = (client.settings ?? {}) as {
    staticAdPromptsArePlaceholder?: boolean;
    brandType?: string;
    staticAdReferenceUrls?: string[];
    brandGuidelines?: {
      colors?: { secondary?: string; accent?: string; palette?: string[] };
      fonts?: { heading?: string; body?: string };
      tone?: { keywords?: string[]; notes?: string };
    };
  };
  const bg = settings.brandGuidelines;
  const hasGuidelines = !!(
    bg &&
    (bg.colors?.palette?.length ||
      bg.colors?.secondary ||
      bg.colors?.accent ||
      bg.fonts?.heading ||
      bg.fonts?.body ||
      bg.tone?.keywords?.length ||
      bg.tone?.notes)
  );

  const [config] = await db
    .select({ updatedAt: schema.clientStaticAdConfig.updatedAt })
    .from(schema.clientStaticAdConfig)
    .where(eq(schema.clientStaticAdConfig.clientId, client.id))
    .limit(1);

  const jobs = await db
    .select({
      id: schema.clientStaticAdPromptJobs.id,
      status: schema.clientStaticAdPromptJobs.status,
      stage: schema.clientStaticAdPromptJobs.stage,
      errorMessage: schema.clientStaticAdPromptJobs.errorMessage,
      createdAt: schema.clientStaticAdPromptJobs.createdAt,
      publishedAt: schema.clientStaticAdPromptJobs.publishedAt,
    })
    .from(schema.clientStaticAdPromptJobs)
    .where(eq(schema.clientStaticAdPromptJobs.clientId, client.id))
    .orderBy(desc(schema.clientStaticAdPromptJobs.createdAt))
    .limit(10);

  const productCount = await db
    .select({ id: schema.clientProducts.id })
    .from(schema.clientProducts)
    .where(eq(schema.clientProducts.clientId, client.id));

  return NextResponse.json({
    // No config row at all also means "not real prompts yet".
    isPlaceholder: !config || settings.staticAdPromptsArePlaceholder !== false,
    hasConfig: !!config,
    brandType: settings.brandType ?? "products",
    vertical: client.vertical,
    hasGuidelines,
    productCount: productCount.length,
    referenceUrls: Array.isArray(settings.staticAdReferenceUrls) ? settings.staticAdReferenceUrls : [],
    promptsUpdatedAt: config?.updatedAt ?? null,
    jobs,
  });
}

/** POST — enqueue a prompt-generation build and kick it off in after(). */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { slug } = await params;
  const client = await resolveClient(slug);
  if (!client) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  // Don't double-run: return any in-flight job. Each run costs ~8+N Opus calls.
  const [inflight] = await db
    .select({ id: schema.clientStaticAdPromptJobs.id, status: schema.clientStaticAdPromptJobs.status })
    .from(schema.clientStaticAdPromptJobs)
    .where(
      and(
        eq(schema.clientStaticAdPromptJobs.clientId, client.id),
        eq(schema.clientStaticAdPromptJobs.status, "running")
      )
    )
    .limit(1);
  if (inflight) return NextResponse.json({ jobId: inflight.id, status: "running" }, { status: 202 });

  const body = (await req.json().catch(() => ({}))) as {
    brandType?: "products" | "services";
    vertical?: string;
    referenceUrls?: string[];
  };

  // Persist any admin corrections to the brand record so the pipeline reads them.
  const settings = (client.settings ?? {}) as Record<string, unknown>;
  const brandType = body.brandType ?? (settings.brandType as "products" | "services" | undefined) ?? "products";
  const referenceUrls = Array.isArray(body.referenceUrls)
    ? body.referenceUrls.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
    : ((settings.staticAdReferenceUrls as string[] | undefined) ?? []);
  if (body.brandType || body.vertical || body.referenceUrls) {
    await db
      .update(schema.clients)
      .set({
        ...(body.vertical ? { category: body.vertical } : {}),
        settings: {
          ...settings,
          brandType,
          ...(body.referenceUrls ? { staticAdReferenceUrls: referenceUrls } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.clients.id, client.id));
  }

  const [job] = await db
    .insert(schema.clientStaticAdPromptJobs)
    .values({
      clientId: client.id,
      status: "pending",
      brandType,
      vertical: body.vertical ?? client.vertical ?? null,
      referenceUrls,
      triggeredBy: auth.portalUser.id,
    })
    .returning({ id: schema.clientStaticAdPromptJobs.id });

  after(() =>
    executePromptJob(job.id).catch((e) =>
      console.error("[static-ad-prompts] executePromptJob failed", job.id, e)
    )
  );

  return NextResponse.json({ jobId: job.id, status: "pending" }, { status: 202 });
}
