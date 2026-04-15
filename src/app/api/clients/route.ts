import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { desc, eq, sql } from "drizzle-orm";
import { provisionClient } from "@/lib/client-provisioning";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients — List all clients
 */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const rows = await db
    .select()
    .from(schema.clients)
    .orderBy(desc(schema.clients.createdAt));

  return NextResponse.json(rows);
}

/**
 * POST /api/clients — Create a new client with auto-provisioning
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  // Only admin can create clients
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json();
  const { clientName, website, category, primaryMarket, currency, cluster, logoUrl, brandColor, monthlyAdSpend, notes } = body;

  if (!clientName || typeof clientName !== "string" || clientName.trim().length === 0) {
    return NextResponse.json({ error: "clientName is required" }, { status: 400 });
  }

  const clientSlug = slugify(clientName);

  // Check slug uniqueness
  const [existing] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, clientSlug))
    .limit(1);

  if (existing) {
    return NextResponse.json({ error: `Client slug "${clientSlug}" already exists` }, { status: 409 });
  }

  try {
    const client = await provisionClient(
      { clientName: clientName.trim(), clientSlug, website, category, primaryMarket, currency, cluster, logoUrl, brandColor, monthlyAdSpend, notes },
      auth.portalUser.id
    );
    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create client";
    console.error("[api/clients] POST error:", message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
