import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { toExternalUrl } from "@/lib/r2";
import {
  craftPromptAgent,
  generateStudioFlowPrompt,
  cleanPrompt,
  formatProductOnlyTemplate,
  formatDualRefTemplate,
  formatBrollTemplate,
  formatArollStreetWithProductTemplate,
  formatArollStreetNoProductTemplate,
  formatArollTalkingHeadTemplate,
  formatArollPodcastWithRefsTemplate,
  formatArollPodcastNoRefsTemplate,
  formatArollGreenScreenTemplate,
  formatNoRefTemplate,
  cleanVoiceDialogue,
} from "@/lib/video-generation/pipeline";
import { submitVideoJob } from "@/lib/video-generation/video-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min timeout for multi-step AI pipeline

/**
 * POST /api/video-generation/generate
 *
 * Orchestrates the full video generation pipeline:
 * 1. Craft prompt (code)
 * 2. Studio Flow V2 (GPT)
 * 3. Cleanup (GPT)
 * 4. Template format (Claude Opus/Sonnet)
 * 5. Voice cleanup (Claude, A-Roll only)
 * 6. Submit to Seedance 2.0 (Muapi)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const body = await request.json();
  const {
    clientId,
    productId,
    characterId,
    characterIds,
    sceneId,
    script,
    duration = 15,
    aspectRatio = "9:16",
    hasCharacter = false,
    videoType = "ugc",
    arollStyle,
  } = body;

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required — select a client first" }, { status: 400 });
  }

  const isAroll = videoType === "aroll";
  const hasProduct = !!productId;

  // Validate inputs
  if (!isAroll && videoType !== "ugc" && !productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }
  if (!script?.trim()) {
    return NextResponse.json({ error: "script is required" }, { status: 400 });
  }

  // Fetch product from clientProducts (optional for A-Roll)
  let product: { id: string; name: string; videoImageUrl: string | null } | null = null;
  if (productId) {
    const [p] = await db
      .select()
      .from(schema.clientProducts)
      .where(eq(schema.clientProducts.id, productId));

    if (!p) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (!isAroll && !p.videoImageUrl) {
      return NextResponse.json({ error: "Product has no 9:16 video image" }, { status: 400 });
    }
    product = { id: p.id, name: p.productName, videoImageUrl: p.videoImageUrl };
  }

  // Fetch characters (single for UGC, up to 2 for podcast)
  const characterList: { id: string; name: string; description: string | null; imageUrl: string }[] = [];
  const resolvedCharacterIds: string[] = Array.isArray(characterIds) ? characterIds : (characterId ? [characterId] : []);
  if (resolvedCharacterIds.length > 0 && (videoType === "ugc" || arollStyle === "podcast")) {
    for (const cid of resolvedCharacterIds.slice(0, 2)) {
      const [c] = await db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.id, cid));
      if (c) characterList.push(c);
    }
  }
  const character = characterList[0] || null;

  // Fetch scene (optional — podcast mode)
  let scene: { id: string; imageUrl: string } | null = null;
  if (sceneId && arollStyle === "podcast") {
    const [s] = await db
      .select()
      .from(schema.scenes)
      .where(eq(schema.scenes.id, sceneId));
    if (s) scene = s;
  }

  // Create generation record with clientId
  const [generation] = await db
    .insert(schema.videoGenerations)
    .values({
      clientId,
      userId: auth.portalUser.id,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      videoType,
      arollStyle: isAroll ? arollStyle : null,
      hasCharacter: videoType === "ugc" ? hasCharacter : false,
      script: script.trim(),
      duration: Number(duration),
      aspectRatio,
      status: "pending",
      currentStep: 0,
    })
    .returning();

  const generationId = generation.id;
  const isNoRefUGC = videoType === "ugc" && !productId && !hasCharacter;

  try {
    // ── Step 1: Craft Prompt (Claude Agent) ──
    let crafterResult: string;
    try {
      const characterNames = characterList.map((c) => c.name);
      const characterDescriptions = characterList.map((c) => ({
        name: c.name,
        description: c.description || "",
      }));

      crafterResult = await craftPromptAgent({
        productName: product?.name ?? "",
        hasCharacter: videoType === "ugc" ? hasCharacter : characterList.length > 0,
        script: script.trim(),
        videoType,
        arollStyle,
        hasProduct,
        characterNames,
        characterDescriptions,
      });
    } catch (err) {
      await db
        .update(schema.videoGenerations)
        .set({ status: "error", errorMessage: `Step 1 failed: ${err instanceof Error ? err.message : String(err)}`, updatedAt: new Date() })
        .where(eq(schema.videoGenerations.id, generationId));
      return NextResponse.json({ error: "Prompt crafting failed", failedStep: 1, generationId }, { status: 500 });
    }

    await db
      .update(schema.videoGenerations)
      .set({ crafterPrompt: crafterResult, currentStep: 1, updatedAt: new Date() })
      .where(eq(schema.videoGenerations.id, generationId));

    // ── Step 2: Studio Flow V2 (GPT) ──
    let studioFlowResult: string;
    try {
      studioFlowResult = await generateStudioFlowPrompt(crafterResult);
    } catch (err) {
      await db
        .update(schema.videoGenerations)
        .set({ status: "error", errorMessage: `Step 2 failed: ${err instanceof Error ? err.message : String(err)}`, updatedAt: new Date() })
        .where(eq(schema.videoGenerations.id, generationId));
      return NextResponse.json({ error: "Studio Flow prompt generation failed", failedStep: 2, generationId }, { status: 500 });
    }

    await db
      .update(schema.videoGenerations)
      .set({ studioFlowPrompt: studioFlowResult, currentStep: 2, updatedAt: new Date() })
      .where(eq(schema.videoGenerations.id, generationId));

    // ── Step 3: Cleanup (GPT) ──
    let cleanedResult: string;
    try {
      cleanedResult = await cleanPrompt(studioFlowResult);
    } catch (err) {
      await db
        .update(schema.videoGenerations)
        .set({ status: "error", errorMessage: `Step 3 failed: ${err instanceof Error ? err.message : String(err)}`, updatedAt: new Date() })
        .where(eq(schema.videoGenerations.id, generationId));
      return NextResponse.json({ error: "Prompt cleanup failed", failedStep: 3, generationId }, { status: 500 });
    }

    await db
      .update(schema.videoGenerations)
      .set({ cleanedPrompt: cleanedResult, currentStep: 3, updatedAt: new Date() })
      .where(eq(schema.videoGenerations.id, generationId));

    // ── Step 4: Template Format (Claude) ──
    let finalPrompt: string;
    try {
      if (isAroll && arollStyle === "street-interview") {
        finalPrompt = hasProduct
          ? await formatArollStreetWithProductTemplate(cleanedResult, aspectRatio, Number(duration))
          : await formatArollStreetNoProductTemplate(cleanedResult, aspectRatio, Number(duration));
      } else if (isAroll && arollStyle === "talking-head") {
        finalPrompt = await formatArollTalkingHeadTemplate(cleanedResult, aspectRatio, Number(duration));
      } else if (isAroll && arollStyle === "podcast") {
        const hasRefs = !!character || !!scene;
        finalPrompt = hasRefs
          ? await formatArollPodcastWithRefsTemplate(cleanedResult, aspectRatio, Number(duration))
          : await formatArollPodcastNoRefsTemplate(cleanedResult, aspectRatio, Number(duration));
      } else if (isAroll && arollStyle === "green-screen") {
        finalPrompt = await formatArollGreenScreenTemplate(cleanedResult, aspectRatio, Number(duration));
      } else if (videoType === "broll") {
        finalPrompt = await formatBrollTemplate(cleanedResult, aspectRatio, Number(duration));
      } else if (isNoRefUGC) {
        finalPrompt = await formatNoRefTemplate(cleanedResult, aspectRatio, Number(duration));
      } else if (hasCharacter) {
        finalPrompt = await formatDualRefTemplate(cleanedResult, aspectRatio, Number(duration));
      } else {
        finalPrompt = await formatProductOnlyTemplate(cleanedResult, aspectRatio, Number(duration));
      }
    } catch (err) {
      await db
        .update(schema.videoGenerations)
        .set({ status: "error", errorMessage: `Step 4 failed: ${err instanceof Error ? err.message : String(err)}`, updatedAt: new Date() })
        .where(eq(schema.videoGenerations.id, generationId));
      return NextResponse.json({ error: "Template formatting failed", failedStep: 4, generationId }, { status: 500 });
    }

    await db
      .update(schema.videoGenerations)
      .set({ finalPrompt, currentStep: 4, updatedAt: new Date() })
      .where(eq(schema.videoGenerations.id, generationId));

    // ── Step 5: Voice Cleanup (Claude, A-Roll only) ──
    let promptForSeedance = finalPrompt;
    if (isAroll || isNoRefUGC) {
      try {
        promptForSeedance = await cleanVoiceDialogue(finalPrompt);
      } catch (err) {
        await db
          .update(schema.videoGenerations)
          .set({ status: "error", errorMessage: `Step 5 failed: ${err instanceof Error ? err.message : String(err)}`, updatedAt: new Date() })
          .where(eq(schema.videoGenerations.id, generationId));
        return NextResponse.json({ error: "Voice cleanup failed", failedStep: 5, generationId }, { status: 500 });
      }

      await db
        .update(schema.videoGenerations)
        .set({ voiceCleanedPrompt: promptForSeedance, currentStep: 5, updatedAt: new Date() })
        .where(eq(schema.videoGenerations.id, generationId));
    }

    // ── Step 5/6: Submit to Seedance 2.0 ──
    const seedanceStep = (isAroll || isNoRefUGC) ? 6 : 5;
    const imageUrls: string[] = [];

    if (product?.videoImageUrl) {
      imageUrls.push(toExternalUrl(product.videoImageUrl));
    }
    if (scene) {
      imageUrls.push(toExternalUrl(scene.imageUrl));
    }
    for (const c of characterList) {
      imageUrls.push(toExternalUrl(c.imageUrl));
    }

    let muapiResult;
    try {
      muapiResult = await submitVideoJob({
        prompt: promptForSeedance,
        imageUrls,
        aspectRatio,
        duration: Number(duration),
      });
    } catch (err) {
      await db
        .update(schema.videoGenerations)
        .set({ status: "error", errorMessage: `Step ${seedanceStep} failed: ${err instanceof Error ? err.message : String(err)}`, updatedAt: new Date() })
        .where(eq(schema.videoGenerations.id, generationId));
      return NextResponse.json({ error: "Seedance submission failed", failedStep: seedanceStep, generationId }, { status: 500 });
    }

    await db
      .update(schema.videoGenerations)
      .set({
        muapiRequestId: muapiResult.requestId,
        status: "processing",
        currentStep: seedanceStep,
        updatedAt: new Date(),
      })
      .where(eq(schema.videoGenerations.id, generationId));

    return NextResponse.json({
      generationId,
      muapiRequestId: muapiResult.requestId,
      completedSteps: seedanceStep,
    });
  } catch (err) {
    // Catch-all for unexpected errors
    await db
      .update(schema.videoGenerations)
      .set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
        updatedAt: new Date(),
      })
      .where(eq(schema.videoGenerations.id, generationId));

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pipeline failed", generationId },
      { status: 500 }
    );
  }
}
