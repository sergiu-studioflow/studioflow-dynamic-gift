import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getPresignedUploadUrl, uploadToR2 } from "@/lib/r2";
import { getClientStoragePrefix } from "@/lib/client-api-helpers";
import { v4 as uuid } from "uuid";


const SLUG_RE = /^[a-z0-9][a-z0-9/-]*$/;
const CLIENT_SLUG_RE = /^[a-z0-9-]+$/;
const ASSET_TYPE_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/mp3",
];

const MAX_SIZE = 500 * 1024 * 1024; // 500 MB

/**
 * Resolve the R2 storage prefix.
 *
 * Three resolution modes (in order of preference):
 * 1. clientId  — DB-validated; reads storage_prefix from clients/brands table (most secure)
 * 2. clientSlug — regex-validated; trusts caller. Used by characters/scenes uploads.
 * 3. brandSlug or env — agency-level fallback for shared assets / single-brand portals
 */
async function resolveStoragePrefix(opts: {
  clientId?: string | null;
  clientSlug?: string | null;
  brandSlug?: string | null;
}): Promise<string> {
  const { clientId, clientSlug, brandSlug } = opts;

  if (clientId) {
    const prefix = await getClientStoragePrefix(clientId);
    if (prefix) return prefix;
  }

  const raw = brandSlug || process.env.BRAND_SLUG || "default";
  const slug = raw.trim();
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid brand slug ${JSON.stringify(raw)} — must match ${SLUG_RE}`);
  }

  if (clientSlug && CLIENT_SLUG_RE.test(clientSlug.trim())) {
    return `brands/${slug}/${clientSlug.trim()}`;
  }

  return slug === "demo" ? "demo" : `brands/${slug}`;
}

/**
 * POST /api/upload
 *
 * Two modes:
 * 1. JSON body with { filename, contentType, brandSlug?, assetType, clientId?, clientSlug? }
 *    → returns presigned URL for direct browser upload
 * 2. FormData with file
 *    → server-side upload to R2, returns public URL
 *
 * Multi-client routing: pass clientId (preferred, DB-validated) or clientSlug
 * (regex-validated). Falls back to agency-level when neither is supplied.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const contentType = req.headers.get("content-type") || "";

    // Mode 1: Presigned URL request (JSON body)
    if (contentType.includes("application/json")) {
      const { filename, contentType: fileType, brandSlug, assetType, clientId, clientSlug } = await req.json();

      if (!filename || !fileType) {
        return NextResponse.json({ error: "filename and contentType required" }, { status: 400 });
      }
      if (!ALLOWED_TYPES.includes(fileType)) {
        return NextResponse.json({ error: `File type ${fileType} not allowed` }, { status: 400 });
      }

      const storagePrefix = await resolveStoragePrefix({ clientId, clientSlug, brandSlug });
      const ext = filename.split(".").pop() || "bin";
      const safeAssetType = (assetType || "uploads").trim();
      if (!ASSET_TYPE_RE.test(safeAssetType)) {
        return NextResponse.json({ error: `Invalid assetType ${JSON.stringify(assetType)}` }, { status: 400 });
      }
      const key = `${storagePrefix}/${safeAssetType}/${uuid()}.${ext}`;
      const presignedUrl = await getPresignedUploadUrl(key, fileType);
      const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

      return NextResponse.json({ presignedUrl, publicUrl, key });
    }

    // Mode 2: Direct file upload (FormData)
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const brandSlug = (formData.get("brandSlug") as string) || undefined;
    const assetType = (formData.get("assetType") as string) || "uploads";
    const clientId = (formData.get("clientId") as string) || undefined;
    const clientSlug = (formData.get("clientSlug") as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `File type ${file.type} not allowed` }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 500MB)" }, { status: 400 });
    }

    const storagePrefix = await resolveStoragePrefix({ clientId, clientSlug, brandSlug });
    const ext = file.name.split(".").pop() || "bin";
    const safeAssetType = (assetType || "uploads").trim();
    if (!ASSET_TYPE_RE.test(safeAssetType)) {
      return NextResponse.json({ error: `Invalid assetType ${JSON.stringify(assetType)}` }, { status: 400 });
    }
    const key = `${storagePrefix}/${safeAssetType}/${uuid()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);

    return NextResponse.json({ url, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[api/upload] Error:", message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
