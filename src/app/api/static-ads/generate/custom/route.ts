import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { analyzeReferenceAd, generateCustomPrompt } from "@/lib/static-ads/custom-pipeline";
import { submitKieJob, REFINE_PROMPT } from "@/lib/static-ads/kie-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/static-ads/generate/custom
 *
 * Multi-format + auto-refinement pipeline.
 *
 * Body: {
 *   productId, referenceImageUrl, adCopy?, clientId, variationCount?,
 *   aspectRatios: string[],     // 1+ ratios; "auto" must be the only entry if present
 *   aspectRatio?: string,        // legacy single-format input — wrapped into aspectRatios
 *   resolution?: "1K"|"2K"|"4K"
 * }
 *
 * For each requested format we run Agent 1 (shared, reference-image-only), N
 * parallel Agent 2 passes (one per variation), then insert N intermediate
 * rows (mode='intermediate', kie_job_id set after Nano Banana submit) and
 * N matching refined rows (mode='refined', kie_job_id=NULL initially,
 * sourceGenerationId pointing at the paired intermediate). The intermediate
 * rows are hidden from the gallery; the refined rows are what the user sees.
 *
 * GPT Image 2 (the refinement step) is fired LATER by /generate/[id] when
 * the refined row is polled and its source intermediate has just completed.
 * This keeps the request here bounded by Nano Banana submission latency only.
 *
 * Returns:
 *   { formats: [{ aspectRatio, batchId, items: [{ refinedId, sourceVariationId }] }],
 *     completedSteps: 3 }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  let body: {
    productId: string;
    referenceImageUrl: string;
    adCopy?: string;
    aspectRatio?: string;
    aspectRatios?: string[];
    resolution?: string;
    clientId?: string;
    variationCount?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { productId, referenceImageUrl, adCopy, resolution, clientId } = body;

  if (!productId || !referenceImageUrl) {
    return NextResponse.json({ error: "productId and referenceImageUrl are required" }, { status: 400 });
  }
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required — select a client first" }, { status: 400 });
  }

  const VALID_RATIOS = ["auto", "1:1", "1:4", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

  // Normalize aspectRatios. Prefer the array form; fall back to legacy `aspectRatio` string.
  let aspectRatios: string[];
  if (Array.isArray(body.aspectRatios) && body.aspectRatios.length > 0) {
    aspectRatios = Array.from(new Set(body.aspectRatios));
  } else if (body.aspectRatio) {
    aspectRatios = [body.aspectRatio];
  } else {
    aspectRatios = ["auto"];
  }
  for (const r of aspectRatios) {
    if (!VALID_RATIOS.includes(r)) {
      return NextResponse.json({ error: `Invalid aspect ratio: ${r}` }, { status: 400 });
    }
  }
  if (aspectRatios.includes("auto") && aspectRatios.length > 1) {
    return NextResponse.json(
      { error: "\"auto\" cannot be combined with explicit aspect ratios — pick one or the other" },
      { status: 400 }
    );
  }

  const VALID_RESOLUTIONS = ["1K", "2K", "4K"];
  if (resolution && !VALID_RESOLUTIONS.includes(resolution)) {
    return NextResponse.json({ error: `Invalid resolution: ${resolution}` }, { status: 400 });
  }
  const resolvedResolution = resolution || "2K";

  if (adCopy && adCopy.length > 5000) {
    return NextResponse.json({ error: "Ad copy must be under 5000 characters" }, { status: 400 });
  }

  const rawCount = Number(body.variationCount ?? 1);
  const variationCount = Number.isFinite(rawCount)
    ? Math.min(5, Math.max(1, Math.trunc(rawCount)))
    : 1;

  // Fetch product from client_products (per-client).
  const [product] = await db
    .select()
    .from(schema.clientProducts)
    .where(eq(schema.clientProducts.id, productId))
    .limit(1);

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (product.clientId !== clientId) {
    return NextResponse.json({ error: "Product belongs to a different client" }, { status: 403 });
  }
  if (!product.imageUrl) {
    return NextResponse.json({ error: "Product has no image — required for ad generation" }, { status: 400 });
  }

  // ── Step 1: Agent 1 once (reference-image analysis is format-independent) ──
  let analysisJson: string;
  try {
    analysisJson = await analyzeReferenceAd(referenceImageUrl, clientId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed", failedStep: 1 },
      { status: 500 }
    );
  }

  // Resolve the input image URLs once — they're reused across every format's
  // Nano Banana submission. DG-specific: also include the brand logos (color
  // + white wordmark) from clientStaticAdConfig so Nano Banana can reproduce
  // them faithfully in the generated ad.
  //
  // NOTE: we deliberately pass the RAW public R2 URLs to Kie, not presigned
  // URLs. `toAccessibleUrl()` returns 10-min-expiring presigned URLs; when
  // Kie's processing queue takes longer than 10 minutes to pick up the job
  // (observed during DG's first v2 generation), the URL expires before Kie's
  // worker fetches the image, producing a 403 that Kie surfaces as a Python
  // `requests.HTTPError` in failMsg. The public r2.dev URL doesn't expire and
  // works fine for Kie / Anthropic / browser consumers alike.
  const accessibleRefUrl = referenceImageUrl;
  const accessibleProductUrl = product.imageUrl!;
  const brandLogoUrls: string[] = [];
  try {
    const [brandConfig] = await db
      .select({
        brandLogoUrl: schema.clientStaticAdConfig.brandLogoUrl,
        brandLogoWhiteUrl: schema.clientStaticAdConfig.brandLogoWhiteUrl,
      })
      .from(schema.clientStaticAdConfig)
      .where(eq(schema.clientStaticAdConfig.clientId, clientId))
      .limit(1);
    if (brandConfig?.brandLogoUrl) {
      brandLogoUrls.push(brandConfig.brandLogoUrl);
    }
    if (brandConfig?.brandLogoWhiteUrl) {
      brandLogoUrls.push(brandConfig.brandLogoWhiteUrl);
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to prepare input images",
        failedStep: 3,
      },
      { status: 500 }
    );
  }

  // ── Step 2: Run Agent 2 N times ONCE, format-neutral. The same N prompts
  //   are then submitted to Kie under every requested aspect ratio so each
  //   variation index produces the SAME creative concept rendered across
  //   every format crop. Per-format prompts (the old behavior) produced
  //   completely different copy/composition per crop, which the team flagged
  //   as unexpected. Kie's API `aspect_ratio` parameter handles the framing.
  //
  //   We feed Agent 2 `aspectRatio: "auto"` so its output isn't biased toward
  //   one specific format — Kie's per-submission param then reframes the
  //   concept into the requested crop.
  const promptResults = await Promise.allSettled(
    Array.from({ length: variationCount }, () =>
      generateCustomPrompt({
        analysisJson,
        adCopy: adCopy?.trim() || undefined,
        product: {
          name: product.productName,
          imageUrl: product.imageUrl!,
          visualDescription: product.keyBenefits,
        },
        referenceImageUrl,
        aspectRatio: "auto",
        clientId,
      })
    )
  );

  const succeededPrompts = promptResults.filter((r) => r.status === "fulfilled").length;
  if (succeededPrompts === 0) {
    const firstReason = promptResults.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    return NextResponse.json(
      {
        error:
          firstReason?.reason instanceof Error
            ? firstReason.reason.message
            : "Prompt generation failed for all variations",
        failedStep: 2,
      },
      { status: 500 }
    );
  }

  // ── Step 3: For each format, insert intermediate+refined pairs reusing the
  //   shared prompts above, then fire Nano Banana × N with the format-specific
  //   aspect_ratio API param. Formats process in parallel. ──
  const formatResults = await Promise.all(
    aspectRatios.map(async (formatRatio) => {
      const batchId = randomUUID();

      // Insert N intermediate rows. Failed prompts get inserted as status='error'
      // upfront with a clear errorMessage, so their paired refined row can mirror
      // that state without needing to revisit later.
      const intermediates = await db
        .insert(schema.staticAdGenerations)
        .values(
          promptResults.map((result, i) => {
            const hasPrompt = result.status === "fulfilled";
            const finalPrompt = hasPrompt ? result.value.prompt : "(prompt generation failed)";
            const errorMessage = hasPrompt
              ? null
              : result.reason instanceof Error
                ? result.reason.message
                : "Prompt generation failed";
            return {
              userId: portalUser.id,
              clientId,
              productId: product.id,
              productName: product.productName,
              styleName: "Custom",
              finalPrompt,
              aspectRatio: formatRatio,
              resolution: resolvedResolution,
              outputFormat: "PNG",
              status: hasPrompt ? "pending" : "error",
              errorMessage,
              mode: "intermediate",
              referenceImageUrl,
              adCopy: adCopy?.trim() || null,
              analysisJson,
              batchId,
              batchSize: variationCount,
              batchIndex: i + 1,
            };
          })
        )
        .returning();

      // Insert N matching refined rows. Each refined row's referenceImageUrl
      // is the source variation's R2 URL — but we don't have that yet (it's
      // populated when the intermediate completes). For now seed it with the
      // top-level referenceImageUrl as a placeholder; /generate/[id] will
      // overwrite it once the intermediate persists.
      const refineds = await db
        .insert(schema.staticAdGenerations)
        .values(
          intermediates.map((intermediate, i) => {
            const inheritsError = intermediate.status === "error";
            return {
              userId: portalUser.id,
              clientId,
              productId: product.id,
              productName: product.productName,
              styleName: "Refined",
              finalPrompt: REFINE_PROMPT,
              aspectRatio: formatRatio,
              resolution: resolvedResolution,
              outputFormat: "PNG",
              status: inheritsError ? "error" : "pending",
              errorMessage: inheritsError ? intermediate.errorMessage : null,
              mode: "refined",
              referenceImageUrl, // placeholder; overwritten once intermediate persists
              adCopy: adCopy?.trim() || null,
              analysisJson: null,
              sourceGenerationId: intermediate.id,
              batchId,
              batchSize: variationCount,
              batchIndex: i + 1,
            };
          })
        )
        .returning();

      // Fire N Nano Banana jobs in parallel. Skip ones whose prompt failed
      // (their intermediate is already status='error').
      const kieResults = await Promise.allSettled(
        intermediates.map((intermediate, i) => {
          const promptResult = promptResults[i];
          if (promptResult.status !== "fulfilled") {
            return Promise.reject(
              promptResult.reason instanceof Error
                ? promptResult.reason
                : new Error("Prompt generation failed")
            );
          }
          return submitKieJob({
            prompt: promptResult.value.prompt,
            imageUrls: [accessibleRefUrl, accessibleProductUrl, ...brandLogoUrls],
            aspectRatio: formatRatio,
            resolution: resolvedResolution,
          });
        })
      );

      // Update intermediates with kieJobId or error. If an intermediate ends
      // up errored, propagate that to its paired refined row too so the
      // chain can't strand.
      await Promise.all(
        kieResults.map(async (result, i) => {
          const intermediate = intermediates[i];
          const refined = refineds[i];
          if (intermediate.status === "error") {
            // Already inserted as errored — refined already mirrors it.
            return;
          }
          if (result.status === "fulfilled") {
            await db
              .update(schema.staticAdGenerations)
              .set({
                kieJobId: result.value.taskId,
                status: "generating",
                updatedAt: new Date(),
              })
              .where(eq(schema.staticAdGenerations.id, intermediate.id));
            return;
          }
          const message =
            result.reason instanceof Error ? result.reason.message : "Kie AI submission failed";
          await Promise.all([
            db
              .update(schema.staticAdGenerations)
              .set({ status: "error", errorMessage: message, updatedAt: new Date() })
              .where(eq(schema.staticAdGenerations.id, intermediate.id)),
            db
              .update(schema.staticAdGenerations)
              .set({ status: "error", errorMessage: message, updatedAt: new Date() })
              .where(eq(schema.staticAdGenerations.id, refined.id)),
          ]);
        })
      );

      return {
        aspectRatio: formatRatio,
        batchId,
        items: refineds.map((refined, i) => ({
          refinedId: refined.id,
          sourceVariationId: intermediates[i].id,
        })),
      };
    })
  );

  return NextResponse.json({
    formats: formatResults,
    completedSteps: 3,
  });
}
