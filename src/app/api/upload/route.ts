import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getPresignedUploadUrl, uploadToR2 } from "@/lib/r2";
import { v4 as uuid } from "uuid";

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

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const contentType = req.headers.get("content-type") || "";

    // Mode 1: Presigned URL request (JSON body)
    if (contentType.includes("application/json")) {
      const { filename, contentType: fileType, brandSlug, assetType } = await req.json();

      if (!filename || !fileType) {
        return NextResponse.json({ error: "filename and contentType required" }, { status: 400 });
      }
      if (!ALLOWED_TYPES.includes(fileType)) {
        return NextResponse.json({ error: `File type ${fileType} not allowed` }, { status: 400 });
      }

      const ext = filename.split(".").pop() || "bin";
      const key = `brands/${brandSlug || process.env.BRAND_SLUG || "default"}/${assetType || "uploads"}/${uuid()}.${ext}`;
      const presignedUrl = await getPresignedUploadUrl(key, fileType);
      const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

      return NextResponse.json({ presignedUrl, publicUrl, key });
    }

    // Mode 2: Direct file upload (FormData)
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const brandSlug = (formData.get("brandSlug") as string) || process.env.BRAND_SLUG || "default";
    const assetType = (formData.get("assetType") as string) || "uploads";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `File type ${file.type} not allowed` }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 500MB)" }, { status: 400 });
    }

    const ext = file.name.split(".").pop() || "bin";
    const key = `brands/${brandSlug}/${assetType}/${uuid()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);

    return NextResponse.json({ url, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[api/upload] Error:", message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
