import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { desc, eq, and, notInArray, isNotNull, sql } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

type Row = typeof schema.staticAdGenerations.$inferSelect;

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const status = req.nextUrl.searchParams.get("status");
    const clientId = req.nextUrl.searchParams.get("clientId");
    const groupByBatch = req.nextUrl.searchParams.get("groupByBatch") === "true";
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "100"), 200);
    const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");

    const conditions = [];
    if (clientId) {
      conditions.push(eq(schema.staticAdGenerations.clientId, clientId));
    }
    // Always hide intermediate chain artifacts. `intermediate` is the
    // Nano Banana variation; `logo-refined` is the GPT2 logo-swap step
    // (DG-specific, only present when the client has a brand logo
    // configured). Both are server-only — the user only sees the final
    // `refined` row at the end of the chain.
    conditions.push(
      notInArray(schema.staticAdGenerations.mode, ["intermediate", "logo-refined"])
    );
    if (status && status !== "all") {
      // Explicit filter (Completed / Generating / Error) — show whatever was asked for.
      conditions.push(eq(schema.staticAdGenerations.status, status));
      if (status === "completed") {
        conditions.push(isNotNull(schema.staticAdGenerations.imageUrl));
      }
    } else {
      // Default "All" view: hide stuck-generating rows and previewless completions.
      conditions.push(eq(schema.staticAdGenerations.status, "completed"));
      conditions.push(isNotNull(schema.staticAdGenerations.imageUrl));
      // Belt-and-suspenders: only show rows whose image lives on R2. Older Edit
      // rows with broken cross-client paths still pass the NOT NULL check but
      // would render as broken-image icons; the AdCard <img onError> fallback
      // also hides those.
      conditions.push(
        sql`(${schema.staticAdGenerations.imageUrl} LIKE '%r2.dev%' OR ${schema.staticAdGenerations.imageUrl} LIKE '%r2.cloudflarestorage.com%' OR ${schema.staticAdGenerations.imageUrl} LIKE '%studio-flow.co%')`
      );
    }

    // When grouping, pull more rows up front so that a batch isn't truncated
    // mid-group (5x is enough headroom for batches up to 5 variations).
    const fetchLimit = groupByBatch ? Math.min(limit * 5, 1000) : limit;

    const rows = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.staticAdGenerations.createdAt))
      .limit(fetchLimit)
      .offset(groupByBatch ? 0 : offset);

    const projected = groupByBatch ? collapseBatches(rows, limit, offset) : rows;

    const withAccessibleUrls = await Promise.all(
      projected.map(async (gen) => ({
        ...gen,
        imageUrl: gen.imageUrl ? await toAccessibleUrl(gen.imageUrl) : null,
        thumbnailUrl: gen.thumbnailUrl ? await toAccessibleUrl(gen.thumbnailUrl) : null,
      }))
    );

    return NextResponse.json(withAccessibleUrls);
  } catch (err) {
    console.error("[static-ads/gallery]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Collapse rows sharing a batch_id into one cover row each, preserving the
 * original createdAt ordering. The cover prefers the first completed variation
 * in the batch (lowest batch_index), falling back to whatever is at index 1.
 *
 * Singletons (batch_id IS NULL OR batch_size = 1) pass through unchanged.
 */
function collapseBatches(rows: Row[], limit: number, offset: number): Row[] {
  type Group = { cover: Row; createdAt: Date; size: number; firstSeenIdx: number };
  const groups = new Map<string, Group>();

  rows.forEach((row, idx) => {
    const key = row.batchId ?? `singleton:${row.id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        cover: row,
        createdAt: row.createdAt,
        size: row.batchSize ?? 1,
        firstSeenIdx: idx,
      });
      return;
    }

    // Prefer a completed row with the lowest batch_index as cover.
    const currentIsBetter =
      (existing.cover.status !== "completed" && row.status === "completed") ||
      (existing.cover.status === row.status &&
        (row.batchIndex ?? 1) < (existing.cover.batchIndex ?? 1));
    if (currentIsBetter) existing.cover = row;
    if (row.createdAt < existing.createdAt) existing.createdAt = row.createdAt;
  });

  return Array.from(groups.values())
    .sort((a, b) => a.firstSeenIdx - b.firstSeenIdx)
    .slice(offset, offset + limit)
    .map((g) => g.cover);
}
