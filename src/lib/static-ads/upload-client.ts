/**
 * Browser-side helpers for image uploads that go through a Vercel function (FormData to
 * /api/upload, /api/winners, /api/reference-library). Function request bodies are capped
 * at 4.5 MB; past that Vercel answers with a plain-text 413 that `res.json()` chokes on
 * ("Unexpected token 'R'…"). Large images are therefore re-encoded client-side first — the
 * same approach the Characters / Scenes libraries use.
 */

/** Target size for a single uploaded file, leaving headroom for multipart overhead. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Largest source image we try to decode and shrink in the browser. */
export const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This image could not be read by the browser"));
    };
    img.src = objectUrl;
  });
}

function encodeJpeg(img: HTMLImageElement, maxDim: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  // JPEG has no alpha — paint white so transparent PNG areas don't turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Returns the file unchanged when it already fits, otherwise a JPEG re-encode that does,
 * stepping quality then dimensions down. Throws a user-readable error when it can't.
 */
export async function fitImageForUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image is ${formatMb(file.size)} — the maximum is ${formatMb(MAX_SOURCE_IMAGE_BYTES)}.`);
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    throw new Error(
      `Image is ${formatMb(file.size)} and couldn't be compressed in the browser — export it as a JPEG or PNG under ${formatMb(MAX_UPLOAD_BYTES)}.`
    );
  }

  let maxDim = Math.min(4096, Math.max(img.naturalWidth, img.naturalHeight));
  let quality = 0.92;
  for (let attempt = 0; attempt < 8; attempt++) {
    const blob = await encodeJpeg(img, maxDim, quality);
    if (blob && blob.size <= MAX_UPLOAD_BYTES) {
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    if (quality > 0.76) quality -= 0.08;
    else maxDim = Math.round(maxDim * 0.75);
  }
  throw new Error(
    `Image is ${formatMb(file.size)} and couldn't be compressed under ${formatMb(MAX_UPLOAD_BYTES)} — export a smaller version.`
  );
}

/**
 * Parse a JSON API response, turning non-JSON bodies (Vercel's plain-text 413 / 504 pages)
 * and error payloads into a readable Error.
 */
export async function readUploadResponse<T>(res: Response, action = "Upload"): Promise<T> {
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const errorMessage =
    data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
      ? (data as { error: string }).error
      : null;

  if (!res.ok) {
    if (errorMessage) throw new Error(errorMessage);
    if (res.status === 413) throw new Error(`${action} failed: the file is too large for the server (max ${formatMb(MAX_UPLOAD_BYTES)}).`);
    if (res.status === 504) throw new Error(`${action} timed out — try again.`);
    throw new Error(`${action} failed (${res.status})`);
  }
  if (data === null) throw new Error(`${action} failed: the server returned an unexpected response.`);
  return data as T;
}
