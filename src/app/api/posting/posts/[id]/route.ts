import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { clampHashtags, isPlatformKey } from "@/lib/posting/platforms";
import { generateOrganicCaptions } from "@/lib/posting/captions";
import { getApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function loadPost(id: string) {
  const [post] = await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id)).limit(1);
  if (!post) return null;
  const targets = await db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, id));
  return { post, targets };
}

/** True once any target has been claimed for publishing (edits/schedule locked). */
function anyTargetClaimed(targets: (typeof schema.postTargets.$inferSelect)[]): boolean {
  return targets.some((t) => t.status === "publishing" || t.status === "published" || t.claimedAt !== null);
}

/**
 * PATCH /api/posting/posts/[id]
 * Actions: edit_target | approve | unschedule | cancel | retry_target |
 *          mark_published | regenerate_captions
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const loaded = await loadPost(id);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { post, targets } = loaded;
  const action = body.action as string;

  // -- Edit a single platform target's caption / hashtags / enabled flag ------
  if (action === "edit_target") {
    const target = targets.find((t) => t.id === body.targetId);
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    if (target.status === "publishing" || target.status === "published") {
      return NextResponse.json({ error: "This platform is already publishing/published — edits are locked." }, { status: 409 });
    }
    const update: Partial<typeof schema.postTargets.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.caption === "string") update.caption = body.caption;
    if (Array.isArray(body.hashtags) && isPlatformKey(target.platform)) {
      update.hashtags = clampHashtags(target.platform, body.hashtags.map(String));
    }
    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    const [row] = await db.update(schema.postTargets).set(update).where(eq(schema.postTargets.id, target.id)).returning();
    return NextResponse.json(row);
  }

  // -- Approve + schedule (one gesture) --------------------------------------
  if (action === "approve") {
    if (!["draft", "scheduled"].includes(post.status)) {
      return NextResponse.json({ error: `Cannot approve a post in status ${post.status}` }, { status: 409 });
    }
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!scheduledAt || isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: "A valid scheduledAt (ISO) is required" }, { status: 400 });
    }
    if (scheduledAt.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "scheduledAt must be in the future" }, { status: 400 });
    }

    // Resolve each enabled target's social account.
    for (const t of targets.filter((x) => x.enabled)) {
      const [acct] = await db
        .select({ id: schema.socialAccounts.id })
        .from(schema.socialAccounts)
        .where(and(eq(schema.socialAccounts.clientId, post.clientId), eq(schema.socialAccounts.platform, t.platform), eq(schema.socialAccounts.enabled, true)))
        .limit(1);
      await db
        .update(schema.postTargets)
        .set({ socialAccountId: acct?.id ?? null, status: "pending", updatedAt: new Date() })
        .where(eq(schema.postTargets.id, t.id));
    }

    const [updated] = await db
      .update(schema.scheduledPosts)
      .set({ status: "scheduled", scheduledAt, approvedBy: auth.portalUser.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, id))
      .returning();

    await db.insert(schema.activityLog).values({
      userId: auth.portalUser.id,
      clientId: post.clientId,
      action: "post_scheduled",
      resourceType: "scheduled_post",
      resourceId: id,
      details: { scheduledAt: scheduledAt.toISOString() },
    });

    return NextResponse.json(updated);
  }

  // -- Unschedule (scheduled → draft) ----------------------------------------
  if (action === "unschedule") {
    if (post.status !== "scheduled" || anyTargetClaimed(targets)) {
      return NextResponse.json({ error: "Can only unschedule a scheduled post before it starts publishing." }, { status: 409 });
    }
    const [updated] = await db
      .update(schema.scheduledPosts)
      .set({ status: "draft", scheduledAt: null, approvedBy: null, approvedAt: null, updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, id))
      .returning();
    return NextResponse.json(updated);
  }

  // -- Cancel ----------------------------------------------------------------
  if (action === "cancel") {
    if (!["draft", "scheduled"].includes(post.status) || anyTargetClaimed(targets)) {
      return NextResponse.json({ error: "Can only cancel a draft/scheduled post before publishing starts." }, { status: 409 });
    }
    const [updated] = await db
      .update(schema.scheduledPosts)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, id))
      .returning();
    return NextResponse.json(updated);
  }

  // -- Retry a terminally-failed target (human-initiated only) ----------------
  if (action === "retry_target") {
    const target = targets.find((t) => t.id === body.targetId);
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    if (target.status !== "failed") {
      return NextResponse.json({ error: "Only failed targets can be retried." }, { status: 409 });
    }
    await db
      .update(schema.postTargets)
      .set({ status: "pending", attemptCount: 0, claimedAt: null, nextAttemptAt: null, igContainerId: null, igPublishStartedAt: null, errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(schema.postTargets.id, target.id));
    // Reopen the parent so the publisher will pick it up.
    if (["failed", "partial"].includes(post.status)) {
      await db
        .update(schema.scheduledPosts)
        .set({ status: "publishing", updatedAt: new Date() })
        .where(eq(schema.scheduledPosts.id, id));
    }
    return NextResponse.json({ ok: true });
  }

  // -- Manually mark an ambiguous_stuck target as published -------------------
  if (action === "mark_published") {
    const target = targets.find((t) => t.id === body.targetId);
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
    await db
      .update(schema.postTargets)
      .set({ status: "published", externalPostId: body.externalPostId || "manual", publishedAt: new Date(), errorCode: null, errorMessage: "Marked published manually", updatedAt: new Date() })
      .where(eq(schema.postTargets.id, target.id));
    return NextResponse.json({ ok: true });
  }

  // -- Regenerate captions (draft only) --------------------------------------
  if (action === "regenerate_captions") {
    if (post.status !== "draft") {
      return NextResponse.json({ error: "Captions can only be regenerated while the post is a draft." }, { status: 409 });
    }
    if (post.sourceType === "review_graphic") {
      return NextResponse.json({ error: "Review-graphic captions are fixed (from the approved review)." }, { status: 400 });
    }
    try {
      const platforms = targets.map((t) => t.platform).filter(isPlatformKey);
      const sourceContext = buildSourceContext(post.sourceSnapshot as Record<string, unknown>);
      const { captions, angleTag } = await generateOrganicCaptions({ clientId: post.clientId, sourceContext, platforms });
      for (const t of targets) {
        if (!isPlatformKey(t.platform)) continue;
        const c = captions[t.platform];
        await db
          .update(schema.postTargets)
          .set({ caption: c.caption, hashtags: c.hashtags, updatedAt: new Date() })
          .where(eq(schema.postTargets.id, t.id));
      }
      await db
        .update(schema.scheduledPosts)
        .set({ angleTag, errorMessage: null, updatedAt: new Date() })
        .where(eq(schema.scheduledPosts.id, id));
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Caption generation failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown or missing action" }, { status: 400 });
}

/** DELETE — hard-remove a draft/cancelled post. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  const { id } = await params;
  const loaded = await loadPost(id);
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["draft", "cancelled", "failed"].includes(loaded.post.status) || anyTargetClaimed(loaded.targets)) {
    return NextResponse.json({ error: "Only draft / cancelled / failed posts can be deleted." }, { status: 409 });
  }
  await db.delete(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id));
  return NextResponse.json({ ok: true });
}

function buildSourceContext(snapshot: Record<string, unknown>): string {
  const s = snapshot as Record<string, string | undefined>;
  const parts: string[] = [];
  if (s.name) parts.push(`Name: ${s.name}`);
  if (s.productName) parts.push(`Product: ${s.productName}`);
  if (s.adCopy) parts.push(`On-image copy: ${s.adCopy}`);
  if (s.script) parts.push(`Video script: ${s.script}`);
  if (s.tags) parts.push(`Tags: ${s.tags}`);
  if (s.notes) parts.push(`Notes: ${s.notes}`);
  if (s.finalPromptExcerpt) parts.push(`Visual direction: ${s.finalPromptExcerpt}`);
  return parts.join("\n") || "A brand creative.";
}
