import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";
import { SOURCE_SYSTEMS, type SourceSystem } from "@/lib/qc/constants";
import { enqueueGateReview } from "@/lib/qc/enqueue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMIT = 200;

/** Existence check for the three text tables (each has its own concrete type). */
async function textRowExists(sourceSystem: SourceSystem, id: string): Promise<boolean> {
  if (sourceSystem === "ad_copy") {
    const r = await db.select({ id: schema.generatedAdCopy.id }).from(schema.generatedAdCopy).where(eq(schema.generatedAdCopy.id, id)).limit(1);
    return r.length > 0;
  }
  if (sourceSystem === "video_brief") {
    const r = await db.select({ id: schema.generatedVideoBriefs.id }).from(schema.generatedVideoBriefs).where(eq(schema.generatedVideoBriefs.id, id)).limit(1);
    return r.length > 0;
  }
  const r = await db.select({ id: schema.contentIdeas.id }).from(schema.contentIdeas).where(eq(schema.contentIdeas.id, id)).limit(1);
  return r.length > 0;
}

/**
 * GET /api/qc/reviews?clientId=&source=&status=
 * The QC queue for one client. clientId is REQUIRED — this portal is multi-client and a
 * review list is never global.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const source = req.nextUrl.searchParams.get("source");
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(schema.gateReviews.clientId, clientId)];
  if (source && SOURCE_SYSTEMS.includes(source as SourceSystem)) {
    conditions.push(eq(schema.gateReviews.sourceSystem, source));
  }
  if (status) conditions.push(eq(schema.gateReviews.status, status));

  const rows = await db
    .select()
    .from(schema.gateReviews)
    .where(and(...conditions))
    .orderBy(desc(schema.gateReviews.createdAt))
    .limit(LIMIT);

  // Presign private-R2 assets so the queue can render thumbnails.
  const reviews = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      assetUrl: r.assetPath ? await toAccessibleUrl(r.assetPath).catch(() => r.assetPath) : null,
    }))
  );

  return NextResponse.json({ reviews });
}

/**
 * POST /api/qc/reviews  { clientId, sourceSystem, sourceId }
 * Manual send-to-gate for a piece that was never auto-enqueued (or was grandfathered).
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;
  if (portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot queue reviews" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { clientId, sourceSystem, sourceId } = body as {
    clientId?: string;
    sourceSystem?: SourceSystem;
    sourceId?: string;
  };

  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  if (!sourceId || !sourceSystem || !SOURCE_SYSTEMS.includes(sourceSystem)) {
    return NextResponse.json({ error: "sourceSystem and sourceId are required" }, { status: 400 });
  }

  // Resolve the row and derive the stored clientId from the ROW, never the request body.
  // Note: `mode` is deliberately never passed here — a manual send-to-gate is an explicit
  // human decision to grade this row, so the exempt-mode guard is bypassed.
  if (sourceSystem === "static") {
    const [row] = await db
      .select()
      .from(schema.staticAdGenerations)
      .where(eq(schema.staticAdGenerations.id, sourceId))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    if (row.clientId !== clientId) {
      return NextResponse.json({ error: "Source belongs to a different client" }, { status: 403 });
    }
    await enqueueGateReview({
      sourceSystem,
      sourceId,
      clientId: row.clientId,
      assetPath: row.imageUrl,
      copyText: row.adCopy,
    });
  } else if (sourceSystem === "video") {
    const [row] = await db
      .select()
      .from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, sourceId))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    if (row.clientId !== clientId) {
      return NextResponse.json({ error: "Source belongs to a different client" }, { status: 403 });
    }
    await enqueueGateReview({
      sourceSystem,
      sourceId,
      clientId: row.clientId,
      assetPath: row.videoUrl,
      copyText: row.script,
    });
  } else {
    // Text lane: the row has no clientId of its own — the grader resolves it from the
    // request parent's brand name. The caller's clientId only scopes the review row.
    const exists = await textRowExists(sourceSystem, sourceId);
    if (!exists) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    await enqueueGateReview({ sourceSystem, sourceId, clientId });
  }

  const [review] = await db
    .select()
    .from(schema.gateReviews)
    .where(and(eq(schema.gateReviews.sourceSystem, sourceSystem), eq(schema.gateReviews.sourceId, sourceId)))
    .limit(1);

  return NextResponse.json({ review: review ?? null });
}
