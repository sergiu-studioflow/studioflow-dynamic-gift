/**
 * Queue-entry orchestration: turn a source creative into a draft scheduled_post
 * with one post_target per platform, captions generated (or mapped for review
 * graphics), and media routed/re-encoded per platform.
 */

import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { BRAND_SLUG } from "@/lib/static-ads/config";
import { toExternalUrl } from "@/lib/r2";
import { loadSource, type SourceType } from "./sources";
import { probeMedia, routePlacement, makeIgVariant } from "./media";
import { generateOrganicCaptions } from "./captions";
import { ALL_PLATFORM_KEYS, isPlatformKey, type PlatformKey } from "./platforms";
import { resolvePrefs } from "./slots";

export type QueueInput = {
  sourceType: SourceType;
  sourceId: string;
  userId: string | null;
  platforms?: string[]; // defaults to all (facebook + instagram)
};

export type QueueResult = { postId: string; status: string; clientId: string };

export async function queuePost(input: QueueInput): Promise<QueueResult> {
  const platforms: PlatformKey[] = (input.platforms || ALL_PLATFORM_KEYS).filter(isPlatformKey);
  if (platforms.length === 0) throw new Error("No valid platforms requested");

  // 1. Load + validate source, build snapshot.
  const src = await loadSource(input.sourceType, input.sourceId);

  // 2. Probe media (also a reachability check). Videos aren't dimensioned.
  const probed = await probeMedia(src.mediaUrl, src.mediaType);

  // 3. Insert parent (generating) + resolve connected accounts.
  const accounts = await db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.clientId, src.clientId));
  const accountByPlatform = new Map(accounts.map((a) => [a.platform, a]));

  // Only create targets for platforms this brand actually has a connected +
  // enabled account for. If NONE are connected yet (initial setup), fall back to
  // all requested platforms so early drafts still work and can be connected later.
  const connected = platforms.filter((p) => accountByPlatform.get(p)?.enabled);
  const activePlatforms = connected.length ? connected : platforms;

  // The brand's own posting timezone, for the display stamp below.
  const [brand] = await db
    .select({ settings: schema.brands.settings })
    .from(schema.brands)
    .where(eq(schema.brands.id, src.clientId))
    .limit(1);
  const prefs = resolvePrefs((brand?.settings as Record<string, unknown> | undefined)?.posting);

  const [parent] = await db
    .insert(schema.scheduledPosts)
    .values({
      clientId: src.clientId,
      userId: input.userId,
      sourceType: input.sourceType,
      [src.fkColumn]: input.sourceId,
      sourceSnapshot: src.snapshot,
      mediaType: src.mediaType,
      mediaUrl: src.mediaUrl,
      mediaWidth: probed.width,
      mediaHeight: probed.height,
      // Stamp the brand's own timezone. The column defaults to Australia/Sydney
      // and nothing used to write it, so every non-Sydney brand's posts were
      // computed correctly in UTC but DISPLAYED in Sydney time in the queue.
      timezone: prefs.timezone,
      status: "generating",
    })
    .returning();

  // 4. Build per-platform targets (placement routing + IG re-encode as needed).
  const storageBase = (await getClientStoragePrefix(src.clientId)) || `brands/${BRAND_SLUG}`;

  const targetRows: (typeof schema.postTargets.$inferInsert)[] = [];
  for (const platform of activePlatforms) {
    const route = routePlacement(platform, src.mediaType, probed.width, probed.height);
    let mediaOverrideUrl: string | null = null;

    if (platform === "instagram" && src.mediaType === "image") {
      if (src.reviewAssets) {
        // review_graphic: use the pre-rendered per-format asset.
        const chosen = route.placement === "story" ? src.reviewAssets.story : src.reviewAssets.ig_feed;
        if (chosen) mediaOverrideUrl = toExternalUrl(chosen);
      } else if (route.needsIgCrop) {
        mediaOverrideUrl = await makeIgVariant({
          sourceUrl: src.mediaUrl,
          storageBase,
          postId: parent.id,
          crop: true,
        });
      } else {
        // Ensure Meta's crawler can reach the image (external public R2 host).
        mediaOverrideUrl = toExternalUrl(src.mediaUrl);
      }
    }
    if (platform === "facebook" && src.reviewAssets?.fb) {
      mediaOverrideUrl = toExternalUrl(src.reviewAssets.fb);
    }

    const account = accountByPlatform.get(platform);
    targetRows.push({
      postId: parent.id,
      clientId: src.clientId,
      socialAccountId: account?.id ?? null,
      platform,
      placement: route.placement,
      enabled: true,
      mediaOverrideUrl,
      status: "pending",
    });
  }

  await db.insert(schema.postTargets).values(targetRows);

  // 5. Captions.
  let angleTag: string | null = null;
  try {
    if (src.reviewCaptions) {
      // review_graphic: map existing captions, skip Claude.
      for (const platform of activePlatforms) {
        const t = targetRows.find((r) => r.platform === platform);
        const isStory = t?.placement === "story";
        const caption =
          platform === "facebook"
            ? src.reviewCaptions.facebook
            : isStory
              ? src.reviewCaptions.story
              : src.reviewCaptions.instagram;
        await db
          .update(schema.postTargets)
          .set({ caption, hashtags: src.reviewCaptions.hashtags, updatedAt: new Date() })
          .where(and(eq(schema.postTargets.postId, parent.id), eq(schema.postTargets.platform, platform)));
      }
    } else {
      const sourceContext = buildSourceContext(src.snapshot);
      const { captions, angleTag: tag } = await generateOrganicCaptions({
        clientId: src.clientId,
        sourceContext,
        platforms: activePlatforms,
      });
      angleTag = tag;
      for (const platform of activePlatforms) {
        const c = captions[platform];
        await db
          .update(schema.postTargets)
          .set({ caption: c.caption, hashtags: c.hashtags, updatedAt: new Date() })
          .where(and(eq(schema.postTargets.postId, parent.id), eq(schema.postTargets.platform, platform)));
      }
    }

    await db
      .update(schema.scheduledPosts)
      .set({ status: "draft", angleTag, updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, parent.id));

    return { postId: parent.id, status: "draft", clientId: src.clientId };
  } catch (err) {
    // Caption failure is non-fatal: land as draft with an error so the user can
    // write captions manually or hit "Regenerate captions".
    await db
      .update(schema.scheduledPosts)
      .set({
        status: "draft",
        errorMessage: `Caption generation failed: ${err instanceof Error ? err.message : "unknown"}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.scheduledPosts.id, parent.id));
    return { postId: parent.id, status: "draft", clientId: src.clientId };
  }
}

function buildSourceContext(snapshot: Record<string, unknown>): string {
  const parts: string[] = [];
  const s = snapshot as Record<string, string | undefined>;
  if (s.name) parts.push(`Name: ${s.name}`);
  if (s.productName) parts.push(`Product: ${s.productName}`);
  if (s.adCopy) parts.push(`On-image copy: ${s.adCopy}`);
  if (s.script) parts.push(`Video script: ${s.script}`);
  if (s.tags) parts.push(`Tags: ${s.tags}`);
  if (s.notes) parts.push(`Notes: ${s.notes}`);
  if (s.finalPromptExcerpt) parts.push(`Visual direction: ${s.finalPromptExcerpt}`);
  return parts.join("\n") || "A brand creative.";
}
