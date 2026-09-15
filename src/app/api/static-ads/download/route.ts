import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { isShippable } from "@/lib/qc/gate";
import { getPresignedDownloadUrl, r2KeyFromStorageUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lifetime of the signed download link — it is followed immediately. */
const DOWNLOAD_URL_TTL_SECONDS = 300;

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

function isR2Url(url: string): boolean {
  const r2Public = (process.env.R2_PUBLIC_URL || "").trim();
  if (r2Public && url.startsWith(`${r2Public}/`)) return true;
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      (hostname.endsWith(".r2.dev") || hostname.endsWith(".r2.cloudflarestorage.com"))
    );
  } catch {
    return false;
  }
}

/**
 * GET /api/static-ads/download?url=&filename=[&format=json]
 *
 * Redirects to a short-lived signed R2 URL that carries
 * `Content-Disposition: attachment`, so the browser downloads straight from R2. The bytes
 * never pass through this function — Vercel caps function responses at 4.5 MB, which every
 * 4K and many 2K PNGs exceed. `format=json` returns `{ url, filename }` instead of
 * redirecting, so a caller can show the gate's error message rather than open a raw JSON tab.
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const url = req.nextUrl.searchParams.get("url");
    const rawFilename = req.nextUrl.searchParams.get("filename") || "ad.png";
    const filename = rawFilename.replace(/[^a-z0-9._-]/gi, "_");
    const wantsJson = req.nextUrl.searchParams.get("format") === "json";

    if (!url) {
      return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
    }

    // Only allow R2 presigned URLs or R2 public URLs
    if (!isR2Url(url)) {
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

    const key = r2KeyFromStorageUrl(url);
    // An R2 URL outside this bucket can't be signed — hand it back as-is (it opens rather
    // than downloads, which beats failing).
    const target = key
      ? await getPresignedDownloadUrl(key, DOWNLOAD_URL_TTL_SECONDS, { attachmentFilename: filename })
      : url;

    if (wantsJson) {
      return NextResponse.json({ url: target, filename });
    }
    return NextResponse.redirect(target, 302);
  } catch (err) {
    console.error("[static-ads/download]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Download failed" },
      { status: 500 }
    );
  }
}
