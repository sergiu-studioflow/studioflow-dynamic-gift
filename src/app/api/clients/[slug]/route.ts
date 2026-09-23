import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { toClient, type Client } from "@/lib/types";
import { EDITABLE_CLIENT_FIELDS, HEX_COLOR, type EditableClientField } from "@/lib/client-fields";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/clients/[slug] — Get client details
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { slug } = await params;
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json<Client>(toClient(client));
}

/**
 * PUT /api/clients/[slug] — Update client
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { slug } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Only the descriptive fields. The body used to be spread straight into the row, so a
  // request could rewrite the slug, storage prefix or id and repoint every R2 path.
  const changes: Partial<Record<EditableClientField, string | null>> = {};
  for (const field of EDITABLE_CLIENT_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value !== null && typeof value !== "string") {
      return NextResponse.json({ error: `${field} must be text` }, { status: 400 });
    }
    changes[field] = value?.trim() || null;
  }
  if (changes.brandColor && !HEX_COLOR.test(changes.brandColor)) {
    return NextResponse.json({ error: "Brand colour must be a hex value like #1a2b3c" }, { status: 400 });
  }
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.clients)
    .set({
      ...changes,
      updatedAt: new Date(),
    })
    .where(eq(schema.clients.clientSlug, slug))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json<Client>(toClient(updated));
}

/**
 * DELETE /api/clients/[slug] — Delete client (cascade deletes all related data)
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { slug } = await params;
  const [deleted] = await db
    .delete(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Log deletion
  await db.insert(schema.activityLog).values({
    action: "client_deleted",
    resourceType: "client",
    details: { clientName: deleted.brandName, clientSlug: deleted.clientSlug },
  });

  return NextResponse.json({ success: true });
}
