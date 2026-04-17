import { db, schema } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/auth";
import { desc, eq, asc, and, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/competitor-ads?competitor_page_id=xxx&snapshot_id=yyy&clientId=zzz
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const competitorPageId = searchParams.get("competitor_page_id");
  const snapshotId = searchParams.get("snapshot_id");
  const clientId = searchParams.get("clientId");

  // If no filters, return available snapshots
  if (!competitorPageId && !snapshotId) {
    const conditions = [];
    if (clientId) conditions.push(eq(schema.competitorAds.clientId, clientId));

    const snapshots = await db
      .selectDistinct({
        snapshotId: schema.competitorAds.snapshotId,
        snapshotLabel: schema.competitorAds.snapshotLabel,
        competitorPageId: schema.competitorAds.competitorPageId,
        brandPageName: schema.competitorAds.brandPageName,
      })
      .from(schema.competitorAds)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.competitorAds.snapshotId));

    return NextResponse.json({ snapshots });
  }

  // Build base conditions
  const baseConditions = [];
  if (clientId) baseConditions.push(eq(schema.competitorAds.clientId, clientId));
  if (competitorPageId) baseConditions.push(eq(schema.competitorAds.competitorPageId, competitorPageId));

  // Find latest snapshot if not specified
  let effectiveSnapshotId = snapshotId;
  if (competitorPageId && !snapshotId) {
    const [latest] = await db
      .selectDistinct({ snapshotId: schema.competitorAds.snapshotId })
      .from(schema.competitorAds)
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .orderBy(desc(schema.competitorAds.snapshotId))
      .limit(1);

    if (!latest) {
      return NextResponse.json({ ads: [], snapshots: [] });
    }
    effectiveSnapshotId = latest.snapshotId;
  }

  // Fetch ads
  const adConditions = [...baseConditions];
  if (effectiveSnapshotId) adConditions.push(eq(schema.competitorAds.snapshotId, effectiveSnapshotId));

  const ads = await db
    .select()
    .from(schema.competitorAds)
    .where(adConditions.length > 0 ? and(...adConditions) : undefined)
    .orderBy(
      asc(schema.competitorAds.metaSortRank),
      desc(schema.competitorAds.adStartDate),
      asc(schema.competitorAds.adArchiveId)
    );

  // Fetch snapshots for dropdown
  const snapshotConditions = [];
  if (clientId) snapshotConditions.push(eq(schema.competitorAds.clientId, clientId));
  if (competitorPageId) snapshotConditions.push(eq(schema.competitorAds.competitorPageId, competitorPageId));

  const snapshots = await db
    .selectDistinct({
      snapshotId: schema.competitorAds.snapshotId,
      snapshotLabel: schema.competitorAds.snapshotLabel,
    })
    .from(schema.competitorAds)
    .where(snapshotConditions.length > 0 ? and(...snapshotConditions) : undefined)
    .orderBy(desc(schema.competitorAds.snapshotId));

  return NextResponse.json({
    ads,
    snapshots,
    currentSnapshotId: effectiveSnapshotId,
  });
}
