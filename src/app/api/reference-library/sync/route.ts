import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { uploadToR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * POST /api/reference-library/sync
 *
 * Called by n8n sync workflow. Accepts a single record to sync:
 * - Downloads image from source URL (Airtable temp URL)
 * - Uploads to shared R2 folder
 * - Inserts/updates in portal DB
 *
 * Body: { airtableRecordId, name, industry, adType?, brand?, sourceImageUrl }
 * Auth: webhook secret (no portal user auth needed)
 */
export async function POST(req: NextRequest) {
  // Verify webhook secret
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { airtableRecordId, name, industry, adType, brand, sourceImageUrl } = body;

    if (!airtableRecordId || !sourceImageUrl) {
      return NextResponse.json({ error: "airtableRecordId and sourceImageUrl required" }, { status: 400 });
    }

    // Check if already exists
    const [existing] = await db
      .select()
      .from(schema.referenceAdLibrary)
      .where(eq(schema.referenceAdLibrary.airtableRecordId, airtableRecordId))
      .limit(1);

    if (existing) {
      return NextResponse.json({ status: "skipped", message: "Already synced", id: existing.id });
    }

    // Download image from Airtable temp URL
    const imgRes = await fetch(sourceImageUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: `Failed to download image: ${imgRes.status}` }, { status: 500 });
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpeg"
      : contentType.includes("webp") ? "webp"
      : contentType.includes("png") ? "png"
      : "png";

    // Upload to shared R2 folder
    const industrySlug = slugify(industry || "other");
    const key = `shared/reference-ad-library/${industrySlug}/${airtableRecordId}.${ext}`;
    const imageUrl = await uploadToR2(key, buffer, contentType);

    // Insert into DB
    const [ref] = await db
      .insert(schema.referenceAdLibrary)
      .values({
        name: name || "Reference Ad",
        imageUrl,
        industry: industry || "Other",
        adType: adType || null,
        brand: brand || null,
        airtableRecordId,
      })
      .returning();

    return NextResponse.json({ status: "synced", id: ref.id, imageUrl });
  } catch (err) {
    console.error("[reference-library/sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
