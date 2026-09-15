/**
 * Factory for creating CRUD API route handlers for client sub-resources.
 * Reduces duplication across brand-intel, products, usps, competitors, creative-dna, research-sources.
 *
 * Every handler is scoped to the brand in the URL. An item route matches a row only
 * when it belongs to that brand, so another brand's id is a 404 — never a read, an
 * edit or a delete of that brand's data.
 */
import { after, NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and, or, asc, desc } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { deleteFromR2, r2KeyFromUrl } from "@/lib/r2";

type ScopedTable = PgTable & { id: AnyPgColumn; clientId: AnyPgColumn; createdAt?: AnyPgColumn };

type SubResourceConfig = {
  table: ScopedTable;
  resourceName: string;
  orderBy?: "asc" | "desc";
  orderColumn?: AnyPgColumn; // e.g. schema.clientProducts.createdAt
  /**
   * Camel-case field names on the row that hold R2 URLs (e.g. ["imageUrl", "videoImageUrl"]).
   * Blank strings in these fields are stored as null.
   * On DELETE, these R2 objects are best-effort deleted after the row is removed.
   * On PUT, if the field's URL changes, the old R2 object is best-effort deleted.
   * See cleanupR2Urls for which objects are ever eligible.
   */
  imageUrlFields?: string[];
};

type ClientRef = { id: string; storagePrefix: string };

function columnOf(table: ScopedTable, field: string): AnyPgColumn | undefined {
  return (table as unknown as Record<string, AnyPgColumn | undefined>)[field];
}

/** An emptied image field is "no image", not an image at "". */
function blankUrlsToNull(body: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = body[field];
    if (typeof value === "string" && !value.trim()) body[field] = null;
  }
}

/**
 * Best-effort delete of the R2 objects behind replaced or deleted URLs.
 * Errors are logged but never thrown — DB state is the source of truth.
 *
 * Any URL on the shared public host resolves to a deletable key, and product images
 * get reused (an image URL copied into another brand's product, a library image). So
 * an object is deleted only when its key sits under this brand's own storage prefix
 * (and not under another brand's prefix nested inside it) AND no row still references
 * the URL; everything else is left alone.
 */
async function cleanupR2Urls(
  table: ScopedTable,
  urls: string[],
  fields: string[],
  client: ClientRef,
  context: string,
): Promise<void> {
  const prefix = client.storagePrefix.replace(/\/+$/, "");
  if (!prefix) return;
  const columns = fields.map((f) => columnOf(table, f)).filter((c): c is AnyPgColumn => !!c);

  let nestedPrefixes: string[];
  try {
    const brands = await db.select({ storagePrefix: schema.clients.storagePrefix }).from(schema.clients);
    nestedPrefixes = brands
      .map((b) => b.storagePrefix.replace(/\/+$/, ""))
      .filter((p) => p.startsWith(`${prefix}/`));
  } catch (err) {
    console.warn(`[client-sub-resource] R2 cleanup skipped for ${context}: could not read brand prefixes`, err);
    return;
  }

  for (const url of new Set(urls)) {
    const key = r2KeyFromUrl(url);
    if (!key) continue;
    const segments = key.split("/");
    const ownKey =
      key.startsWith(`${prefix}/`) &&
      !nestedPrefixes.some((p) => key.startsWith(`${p}/`)) &&
      !segments.includes("..") &&
      !segments.includes(".");
    if (!ownKey) {
      console.info(`[client-sub-resource] keeping ${url} (${context}): not this brand's object`);
      continue;
    }
    try {
      if (columns.length > 0) {
        const [stillUsed] = await db
          .select({ id: table.id })
          .from(table)
          .where(or(...columns.map((c) => eq(c, url))))
          .limit(1);
        if (stillUsed) continue;
      }
      await deleteFromR2(key);
    } catch (err) {
      console.warn(`[client-sub-resource] R2 cleanup failed for ${context}: ${url}`, err);
    }
  }
}

/**
 * Resolve client ID (and its storage prefix) from slug
 */
async function resolveClient(slug: string): Promise<ClientRef | undefined> {
  const [client] = await db
    .select({ id: schema.clients.id, storagePrefix: schema.clients.storagePrefix })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);
  return client;
}

/**
 * Create list + create handlers for a sub-resource collection route.
 */
export function createCollectionHandlers(config: SubResourceConfig) {
  const { table } = config;

  async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;

    const { slug } = await params;
    const client = await resolveClient(slug);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(table)
      .where(eq(table.clientId, client.id))
      .orderBy(
        config.orderColumn
          ? (config.orderBy === "asc" ? asc(config.orderColumn) : desc(config.orderColumn))
          : desc(table.createdAt ?? table.id)
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
    blankUrlsToNull(body, config.imageUrlFields ?? []);
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
  const imageUrlFields = config.imageUrlFields ?? [];

  /** The row with this id, only if it belongs to the brand in the URL. */
  const ownedBy = (client: ClientRef, id: string) => and(eq(table.id, id), eq(table.clientId, client.id));

  async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;

    const { slug, id } = await params;
    const client = await resolveClient(slug);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const [row] = await db.select().from(table).where(ownedBy(client, id)).limit(1);

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  }

  async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    if (auth.portalUser.role === "viewer") {
      return NextResponse.json({ error: "Edit access required" }, { status: 403 });
    }

    const { slug, id } = await params;
    const client = await resolveClient(slug);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const body = await req.json();

    // Remove fields that shouldn't be updated
    delete body.id;
    delete body.clientId;
    delete body.createdAt;
    blankUrlsToNull(body, imageUrlFields);

    // Snapshot existing image URLs so we can clean up replaced ones after the update.
    let previous: Record<string, unknown> | null = null;
    if (imageUrlFields.length > 0) {
      const [existing] = await db.select().from(table).where(ownedBy(client, id)).limit(1);
      previous = existing ?? null;
    }

    const [updated] = await db
      .update(table)
      .set({ ...body, updatedAt: new Date() })
      .where(ownedBy(client, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Best-effort: delete the R2 objects for any image field whose URL changed.
    if (previous) {
      const replaced: string[] = [];
      for (const field of imageUrlFields) {
        const before = previous[field];
        const current = (updated as Record<string, unknown>)[field];
        if (typeof before === "string" && before && before !== current) replaced.push(before);
      }
      if (replaced.length > 0) {
        after(() => cleanupR2Urls(table, replaced, imageUrlFields, client, `${config.resourceName}#${id} replaced`));
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

    const { slug, id } = await params;
    const client = await resolveClient(slug);
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const [deleted] = await db.delete(table).where(ownedBy(client, id)).returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Best-effort: delete R2 objects referenced by the deleted row.
    if (imageUrlFields.length > 0) {
      const urls = imageUrlFields
        .map((field) => (deleted as Record<string, unknown>)[field])
        .filter((url): url is string => typeof url === "string" && !!url);
      if (urls.length > 0) {
        after(() => cleanupR2Urls(table, urls, imageUrlFields, client, `${config.resourceName}#${id} deleted`));
      }
    }

    return NextResponse.json({ success: true });
  }

  return { GET, PUT, DELETE };
}
