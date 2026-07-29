import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { isShippable } from "@/lib/qc/gate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Quality Control download gate. Both generated-asset key layouts embed the owning row's
 * uuid, so a URL maps back to a qc_status. Anything NOT matching these patterns (winners
 * copies, reference library, uploads) returns undefined and is not gated.
 *
 * Keep in sync with the upload sites:
 *   <prefix>/static-ad-system/generated-ads/<id>.<ext>   → static_ad_generations
 *   <prefix>/video-generation/outputs/<id>.<ext>         → video_generations
 */
const QC_GATES = [
  { re: /\/static-ad-system\/generated-ads\/([0-9a-fA-F-]{36})\./, system: "static" as const },
  { re: /\/video-generation\/outputs\/([0-9a-fA-F-]{36})\./, system: "video" as const },
];

async function qcStatusForUrl(url: string): Promise<string | null | undefined> {
  for (const gate of QC_GATES) {
    const match = url.match(gate.re);
    if (!match) continue;
    const id = match[1];
    if (gate.system === "static") {
      const [row] = await db
        .select({ qcStatus: schema.staticAdGenerations.qcStatus })
        .from(schema.staticAdGenerations)
        .where(eq(schema.staticAdGenerations.id, id))
        .limit(1);
      return row?.qcStatus ?? null;
    }
    const [row] = await db
      .select({ qcStatus: schema.videoGenerations.qcStatus })
      .from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id))
      .limit(1);
    return row?.qcStatus ?? null;
  }
  return undefined; // not a gated asset path
}

/**
 * Proxy download — fetches image server-side and returns it with
 * Content-Disposition: attachment so the browser downloads it directly.
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const url = req.nextUrl.searchParams.get("url");
    const rawFilename = req.nextUrl.searchParams.get("filename") || "ad.png";
    const filename = rawFilename.replace(/[^a-z0-9._-]/gi, "_");

    if (!url) {
      return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
    }

    // Only allow R2 presigned URLs or R2 public URLs
    const r2Public = process.env.R2_PUBLIC_URL || "";
    const isR2 = url.includes("r2.cloudflarestorage.com") || url.includes("r2.dev") || (r2Public && url.startsWith(r2Public));
    if (!isR2) {
      return NextResponse.json({ error: "Only R2 URLs are allowed" }, { status: 403 });
    }

    // Hard gate: a creative held by Quality Control cannot leave the portal.
    const qcStatus = await qcStatusForUrl(url);
    if (qcStatus !== undefined && !isShippable(qcStatus)) {
      return NextResponse.json(
        { error: "This creative is held by Quality Control — approve it in the QC queue first." },
        { status: 403 }
      );
    }

    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch image: ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    console.error("[static-ads/download]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Download failed" },
      { status: 500 }
    );
  }
}
