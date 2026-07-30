/**
 * GET /api/clients/[slug]/capabilities
 *
 * Which systems this brand is set up to run, derived from its data. The sidebar
 * reads this instead of the hardcoded slug lists it used to carry, so adding a
 * brand no longer needs a code change and a redeploy.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { capabilitiesForClient } from "@/lib/client-capabilities";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { slug } = await params;

  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);
  if (!client) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  return NextResponse.json(await capabilitiesForClient(client.id));
}
