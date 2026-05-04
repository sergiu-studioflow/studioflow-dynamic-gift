import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deprecated 2026-05-04 — agency-level fallback removed for R2 brand isolation.
 *
 * The replacement is per-client: `/api/clients/[slug]/products/convert-video-image`.
 * That route uses `getClientStoragePrefix(clientId)` so converted video-image variants
 * land at `brands/dynamic-gift/<client>/video-generation/products/<uuid>.png` instead
 * of the agency-level `brands/dynamic-gift/video-generation/products/...`.
 *
 * If you hit this route in logs, find the caller and migrate it to the per-client one.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Deprecated. Use /api/clients/[slug]/products/convert-video-image — it scopes the converted video-image to the client's R2 prefix.",
    },
    { status: 410 },
  );
}
