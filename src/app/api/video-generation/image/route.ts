import { NextRequest, NextResponse } from "next/server";
import { downloadFromR2, r2KeyFromUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * GET /api/video-generation/image?key=...  (preferred — short URL)
 * GET /api/video-generation/image?url=...  (legacy — long URL)
 *
 * Public proxy that serves R2 images without auth.
 * Used by external services (Muapi/Seedance) that can't access private R2.
 */
export async function GET(request: NextRequest) {
  // Accept either a direct R2 key or a full R2 URL
  let r2Key = request.nextUrl.searchParams.get("key");

  if (!r2Key) {
    const url = request.nextUrl.searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "key or url parameter required" }, { status: 400 });
    }
    r2Key = r2KeyFromUrl(url);
    if (!r2Key) {
      return NextResponse.json({ error: "Not an R2 URL" }, { status: 400 });
    }
  }

  try {
    const { buffer, contentType } = await downloadFromR2(r2Key);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "CDN-Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}
