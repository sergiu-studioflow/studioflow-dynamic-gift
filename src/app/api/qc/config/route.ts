import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { providerStatus } from "@/lib/qc/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const toArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 60) : [];

/** GET /api/qc/config?clientId= → the client's ruleset + which judges are reachable. */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const [config] = await db
    .select()
    .from(schema.complianceConfig)
    .where(eq(schema.complianceConfig.clientId, clientId))
    .limit(1);

  return NextResponse.json({ config: config ?? null, providers: await providerStatus() });
}

/**
 * PUT /api/qc/config — upsert the client's ruleset. Every save bumps `version`; the
 * version in force is snapshotted onto each gate_review at enqueue time, so an old grade
 * always shows which ruleset produced it.
 */
export async function PUT(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;
  if (portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot edit the QC ruleset" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const values = {
    bannedPhrasings: toArray(body.bannedPhrasings),
    visualRules: toArray(body.visualRules),
    paletteHexes: toArray(body.paletteHexes),
    productFacts: toArray(body.productFacts),
    brandSafetyNotes: typeof body.brandSafetyNotes === "string" ? body.brandSafetyNotes.trim() || null : null,
    // The winner profile is editable here too — a human can correct what the profiler wrote.
    ...(typeof body.winnerProfile === "string"
      ? { winnerProfile: body.winnerProfile.trim() || null, winnerProfileUpdatedAt: new Date() }
      : {}),
  };

  const [config] = await db
    .insert(schema.complianceConfig)
    .values({ clientId, ...values, version: 1 })
    .onConflictDoUpdate({
      target: schema.complianceConfig.clientId,
      set: {
        ...values,
        version: sql`${schema.complianceConfig.version} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ config });
}
