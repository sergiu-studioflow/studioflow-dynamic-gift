import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { BRAND_SLUG } from "@/lib/static-ads/config";
import { getApiKey } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

/**
 * GET /api/static-ads/health
 * Quick check that all required services are configured. Keys resolve the same way the
 * pipeline does: Settings → API Keys (vault) first, env var as fallback.
 */
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const [anthropicKey, kieKey] = await Promise.all([
    getApiKey("ANTHROPIC_API_KEY").then((k) => !!k.trim()),
    getApiKey("KIE_AI_API_KEY").then((k) => !!k.trim()),
  ]);
  const r2Configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

  let dbConnected = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbConnected = true;
  } catch { /* db unreachable */ }

  return NextResponse.json({
    brandSlug: BRAND_SLUG,
    anthropicKey,
    kieKey,
    r2Configured,
    dbConnected,
    ready: anthropicKey && kieKey && r2Configured && dbConnected,
  });
}
