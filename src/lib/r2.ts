import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


const SLUG_RE = /^[a-z0-9-]+$/;
const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
const R2_BUCKET_NAME = (process.env.R2_BUCKET_NAME || "studioflow-assets").trim();
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").trim();

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadToR2(
  key: string,
  body: Buffer | ReadableStream | Uint8Array,
  contentType: string
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body instanceof Buffer || body instanceof Uint8Array ? body : await streamToBuffer(body),
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${key}`;
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn });
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 600,
  opts: { attachmentFilename?: string } = {}
): Promise<string> {
  const filename = opts.attachmentFilename?.replace(/["\\\r\n]/g, "_");
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    // Makes the browser save the file instead of rendering it.
    ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
  });
  return getSignedUrl(r2, command, { expiresIn });
}

export async function toAccessibleUrl(url: string): Promise<string> {
  const key = r2KeyFromUrl(url);
  if (!key) return url;
  return getPresignedDownloadUrl(key);
}

export async function downloadFromR2(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await r2.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    })
  );
  const bytes = await res.Body!.transformToByteArray();
  return {
    buffer: Buffer.from(bytes),
    contentType: res.ContentType || "application/octet-stream",
  };
}

const R2_PUBLIC_URLS = [
  R2_PUBLIC_URL,
  "https://pub-studioflow.r2.dev",
  "https://pub-c85814e28869441d8a619b3b90562166.r2.dev",
].filter(Boolean);

const R2_EXTERNAL_PUBLIC_URL = "https://pub-c85814e28869441d8a619b3b90562166.r2.dev";

export function toExternalUrl(url: string): string {
  const key = r2KeyFromUrl(url);
  if (!key) return url;
  return `${R2_EXTERNAL_PUBLIC_URL}/${key}`;
}

export function r2KeyFromUrl(url: string): string | null {
  for (const prefix of R2_PUBLIC_URLS) {
    // The host must end exactly where the path begins — a bare startsWith would also
    // accept a look-alike host such as `….r2.dev.evil.example`.
    if (url.startsWith(`${prefix}/`)) {
      return url.slice(prefix.length + 1) || null;
    }
  }
  return null;
}

/**
 * The object key behind `url` only when it sits inside `storagePrefix/` — the owning
 * brand's folder. `studioflow-assets` is shared by every StudioFlow brand, so every
 * delete goes through this: another brand's file, `shared/`, or a URL that isn't ours
 * returns null and storage is left alone.
 */
export function ownedR2Key(
  url: string | null | undefined,
  storagePrefix: string | null | undefined
): string | null {
  const prefix = (storagePrefix ?? "").replace(/\/+$/, "");
  if (!url || !prefix) return null;
  const key = r2KeyFromUrl(url)?.split(/[?#]/)[0];
  if (!key || !key.startsWith(`${prefix}/`)) return null;
  const segments = key.split("/");
  if (segments.includes("..") || segments.includes(".")) return null;
  return key;
}

/**
 * Object key for any URL form the app hands out: a public URL (see r2KeyFromUrl) or a
 * presigned S3-endpoint URL, virtual-hosted (<bucket>.<account>.r2.cloudflarestorage.com/<key>)
 * or path-style (<account>.r2.cloudflarestorage.com/<bucket>/<key>). Null otherwise.
 */
export function r2KeyFromStorageUrl(url: string): string | null {
  const publicKey = r2KeyFromUrl(url);
  if (publicKey) return publicKey.split("?")[0] || null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith(".r2.cloudflarestorage.com")) return null;

  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (parsed.hostname.startsWith(`${R2_BUCKET_NAME}.`)) return path || null;
  if (path.startsWith(`${R2_BUCKET_NAME}/`)) return path.slice(R2_BUCKET_NAME.length + 1) || null;
  return null;
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    })
  );
}

export function r2Key(brandSlug: string, assetType: string, filename: string): string {
  const slug = (brandSlug ?? "").trim();
  const type = (assetType ?? "").trim();
  if (!SLUG_RE.test(slug)) {
    throw new Error(`r2Key: invalid brandSlug ${JSON.stringify(brandSlug)} (must match ${SLUG_RE})`);
  }
  if (!type || /[\s/]/.test(type)) {
    throw new Error(`r2Key: invalid assetType ${JSON.stringify(assetType)} (no whitespace or slashes)`);
  }
  if (slug === "demo") return `demo/${type}/${filename}`;
  return `brands/${slug}/${type}/${filename}`;
}

export function r2Url(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
}

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const result = await reader.read();
    if (result.value) chunks.push(result.value);
    done = result.done;
  }
  return Buffer.concat(chunks);
}
