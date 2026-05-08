/**
 * Factory for creating CRUD API route handlers for client sub-resources.
 * Reduces duplication across brand-intel, products, usps, competitors, creative-dna, research-sources.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and, asc, desc } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { deleteFromR2, r2KeyFromUrl } from "@/lib/r2";

type SubResourceConfig = {
  table: PgTable & { id: any; clientId: any; createdAt?: any };
  resourceName: string;
  orderBy?: "asc" | "desc";
  orderColumn?: any; // e.g. schema.clientProducts.createdAt
  /**
   * Camel-case field names on the row that hold R2 URLs (e.g. ["imageUrl", "videoImageUrl"]).
   * On DELETE, these R2 objects are best-effort deleted after the row is removed.
   * On PUT, if the field's URL changes, the old R2 object is best-effort deleted.
   * URLs that don't resolve to an R2 key (external CDN, null, empty) are skipped silently.
   */
  imageUrlFields?: string[];
};

/**
 * Best-effort delete of R2 keys derived from a row's URL fields.
 * Errors are logged but never thrown — DB state is the source of truth.
 */
async function cleanupR2Urls(
  row: Record<string, any>,
  fields: string[],
  context: string,
): Promise<void> {
  for (const field of fields) {
    const url = row[field];
    if (!url || typeof url !== "string") continue;
    const key = r2KeyFromUrl(url);
    if (!key) continue;
    try {
      await deleteFromR2(key);
    } catch (err) {
      console.warn(`[client-sub-resource] R2 cleanup failed for ${context}.${field}=${url}:`, err);
    }
  }
}

/**
 * Resolve client ID from slug
 */
async function resolveClient(slug: string) {
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);
  return client;
}

/**
 * Create list + create handlers for a sub-resource collection route.
 */
export function createCollectionHandlers(config: SubResourceConfig) {
  const { table, resourceName } = config;

  async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;

    const { slug } = await params;
    const client = await resolveClient(slug);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(table)
      .where(eq((table as any).clientId, client.id))
      .orderBy(
        config.orderColumn
          ? (config.orderBy === "asc" ? asc(config.orderColumn) : desc(config.orderColumn))
          : desc((table as any).createdAt)
      );

    return NextResponse.json(rows);
  }

  async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    if (auth.portalUser.role === "viewer") {
      return NextResponse.json({ error: "Edit access required" }, { status: 403 });
    }

    const { slug } = await params;
    const client = await resolveClient(slug);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const body = await req.json();
    const [created] = await db
      .insert(table)
      .values({ ...body, clientId: client.id })
      .returning();

    return NextResponse.json(created, { status: 201 });
  }

  return { GET, POST };
}

/**
 * Create get, update, delete handlers for a sub-resource item route.
 */
export function createItemHandlers(config: SubResourceConfig) {
  const { table } = config;

  async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const [row] = await db
      .select()
      .from(table)
      .where(eq((table as any).id, id))
      .limit(1);

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  }

  async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    if (auth.portalUser.role === "viewer") {
      return NextResponse.json({ error: "Edit access required" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    // Remove fields that shouldn't be updated
    delete body.id;
    delete body.clientId;
    delete body.createdAt;

    // Snapshot existing image URLs so we can clean up replaced ones after the update.
    const imageUrlFields = config.imageUrlFields ?? [];
    let previous: Record<string, any> | null = null;
    if (imageUrlFields.length > 0) {
      const [existing] = await db
        .select()
        .from(table)
        .where(eq((table as any).id, id))
        .limit(1);
      previous = existing ?? null;
    }

    const [updated] = await db
      .update(table)
      .set({ ...body, updatedAt: new Date() })
      .where(eq((table as any).id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Best-effort: delete the R2 objects for any image field whose URL changed.
    if (previous) {
      const replaced: Record<string, any> = {};
      for (const field of imageUrlFields) {
        const before = previous[field];
        const after = (updated as any)[field];
        if (before && before !== after) replaced[field] = before;
      }
      if (Object.keys(replaced).length > 0) {
        cleanupR2Urls(replaced, imageUrlFields, `${config.resourceName}#${id} replaced`);
      }
    }

    return NextResponse.json(updated);
  }

  async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    if (auth.portalUser.role === "viewer") {
      return NextResponse.json({ error: "Edit access required" }, { status: 403 });
    }

    const { id } = await params;
    const [deleted] = await db
      .delete(table)
      .where(eq((table as any).id, id))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Best-effort: delete R2 objects referenced by the deleted row.
    if (config.imageUrlFields?.length) {
      cleanupR2Urls(deleted as any, config.imageUrlFields, `${config.resourceName}#${id} deleted`);
    }

    return NextResponse.json({ success: true });
  }

  return { GET, PUT, DELETE };
}
