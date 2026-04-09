import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
