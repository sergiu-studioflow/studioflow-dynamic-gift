import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

/**
 * Extract clientId from request URL search params.
 * Returns null if not present (= "All Clients" mode).
 */
export function getClientIdFromRequest(request: NextRequest): string | null {
  return new URL(request.url).searchParams.get("clientId") || null;
}

/**
 * Build a WHERE condition for client-scoped queries.
 * When clientId is null (All Clients mode), returns undefined so the query is unscoped.
 */
export function clientScope(
  clientIdColumn: ReturnType<typeof schema.clients.id.mapFromDriverValue extends (...args: any) => any ? never : any>,
  clientId: string | null
) {
  if (!clientId) return undefined;
  return eq(clientIdColumn, clientId);
}

/**
 * Resolve a client slug to a client UUID.
 */
export async function resolveClientSlug(slug: string): Promise<string | null> {
  const [client] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.clientSlug, slug))
    .limit(1);
  return client?.id || null;
}

/**
 * Get the R2 storage prefix for a client by ID.
 */
export async function getClientStoragePrefix(clientId: string): Promise<string | null> {
  const [client] = await db
    .select({ storagePrefix: schema.clients.storagePrefix })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  return client?.storagePrefix || null;
}
