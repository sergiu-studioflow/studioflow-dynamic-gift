/**
 * Factory for creating CRUD API route handlers for client sub-resources.
 * Reduces duplication across brand-intel, products, usps, competitors, creative-dna, research-sources.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, and, asc, desc } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

type SubResourceConfig = {
  table: PgTable & { id: any; clientId: any; createdAt?: any };
  resourceName: string;
  orderBy?: "asc" | "desc";
  orderColumn?: any; // e.g. schema.clientProducts.createdAt
};

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

    const [updated] = await db
      .update(table)
      .set({ ...body, updatedAt: new Date() })
      .where(eq((table as any).id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    return NextResponse.json({ success: true });
  }

  return { GET, PUT, DELETE };
}
