import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/posting/posts?clientId=&status=
 * Lists scheduled posts (parent + per-platform targets) for a brand.
 * status filter groups: "queue" (draft+scheduled), "history" (terminal), or an exact status.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const clientId = req.nextUrl.searchParams.get("clientId");
  const statusFilter = req.nextUrl.searchParams.get("status") || "all";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "80", 10), 200);

  const conditions = [];
  if (clientId) conditions.push(eq(schema.scheduledPosts.clientId, clientId));

  const queueStatuses = ["generating", "draft", "scheduled", "publishing"];
  const historyStatuses = ["published", "partial", "failed", "cancelled"];
  if (statusFilter === "queue") conditions.push(inArray(schema.scheduledPosts.status, queueStatuses));
  else if (statusFilter === "history") conditions.push(inArray(schema.scheduledPosts.status, historyStatuses));
  else if (statusFilter !== "all") conditions.push(eq(schema.scheduledPosts.status, statusFilter));

  const posts = await db
    .select()
    .from(schema.scheduledPosts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.scheduledPosts.createdAt))
    .limit(limit);

  if (!posts.length) return NextResponse.json([]);

  const ids = posts.map((p) => p.id);
  const targets = await db
    .select()
    .from(schema.postTargets)
    .where(inArray(schema.postTargets.postId, ids));

  const targetsByPost = new Map<string, typeof targets>();
  for (const t of targets) {
    const list = targetsByPost.get(t.postId) || [];
    list.push(t);
    targetsByPost.set(t.postId, list);
  }

  const result = await Promise.all(
    posts.map(async (p) => ({
      ...p,
      mediaPreviewUrl: p.mediaUrl ? await toAccessibleUrl(p.mediaUrl) : null,
      targets: (targetsByPost.get(p.id) || []).sort((a, b) => a.platform.localeCompare(b.platform)),
    }))
  );

  return NextResponse.json(result);
}
