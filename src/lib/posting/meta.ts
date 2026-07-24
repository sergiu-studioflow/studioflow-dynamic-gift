/**
 * Meta Graph API client for auto-posting (Facebook Pages + Instagram).
 *
 * Thin, dependency-free fetch wrapper. Uses ONE agency Business Manager System
 * User token (vault key META_SYSTEM_USER_TOKEN) for every brand — the per-brand
 * page_id / ig_user_id live in the `social_accounts` table.
 *
 * Publishing model:
 *   - Facebook: POST /{page-id}/photos (or /videos) — publishes immediately.
 *   - Instagram: create a media container → poll status_code=FINISHED → publish.
 *     IG has no native scheduling; our cron fires at the due time.
 *
 * The token is never logged. Errors are classified so the publisher can decide
 * retry vs terminal-fail vs account-health flag.
 */

const GRAPH_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaErrorCode =
  | "token_invalid"
  | "media_error"
  | "rate_limited"
  | "quota_exceeded"
  | "unknown";

export class MetaGraphError extends Error {
  code: MetaErrorCode;
  httpStatus: number;
  fbCode?: number;
  fbSubcode?: number;
  constructor(message: string, opts: { code: MetaErrorCode; httpStatus: number; fbCode?: number; fbSubcode?: number }) {
    super(message);
    this.name = "MetaGraphError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.fbCode = opts.fbCode;
    this.fbSubcode = opts.fbSubcode;
  }
}

function classify(httpStatus: number, fbCode?: number, fbSubcode?: number): MetaErrorCode {
  if (fbCode === 190) return "token_invalid"; // invalid/expired/revoked token
  // Rate limiting / throttling
  if (fbCode === 4 || fbCode === 17 || fbCode === 32 || fbCode === 613 || fbCode === 80001 || fbCode === 80002) {
    return "rate_limited";
  }
  // Content-publishing-limit exceeded (IG)
  if (fbCode === 9007 && fbSubcode === 2207042) return "quota_exceeded";
  // Media/content problems (bad image, aspect ratio, unreachable url, invalid param)
  if (fbCode === 100 || fbCode === 9007 || fbSubcode === 2207003 || fbSubcode === 2207008 ||
      fbSubcode === 2207009 || fbSubcode === 2207026 || fbSubcode === 36003) {
    return "media_error";
  }
  if (httpStatus >= 500) return "unknown";
  if (httpStatus === 400) return "media_error";
  return "unknown";
}

type GraphParams = Record<string, string | number | boolean | undefined>;

async function graphFetch<T = Record<string, unknown>>(
  path: string,
  opts: { method?: "GET" | "POST"; params?: GraphParams; token: string }
): Promise<T> {
  const method = opts.method || "GET";
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  const body = new URLSearchParams();
  const params = opts.params || {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (method === "GET") url.searchParams.set(k, String(v));
    else body.set(k, String(v));
  }
  // Token always goes in the query string (never logged in our own logs; not in body).
  url.searchParams.set("access_token", opts.token);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? body.toString() : undefined,
    });
  } catch (err) {
    // Network failure — retryable.
    throw new MetaGraphError(err instanceof Error ? err.message : "network error", {
      code: "unknown",
      httpStatus: 0,
    });
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const errObj = (json.error || {}) as { message?: string; code?: number; error_subcode?: number };
    const code = classify(res.status, errObj.code, errObj.error_subcode);
    throw new MetaGraphError(errObj.message || `Graph API error (${res.status})`, {
      code,
      httpStatus: res.status,
      fbCode: errObj.code,
      fbSubcode: errObj.error_subcode,
    });
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// Connection checks (Test Connection button)
// ---------------------------------------------------------------------------

export async function getPageInfo(pageId: string, token: string): Promise<{ id: string; name: string }> {
  const r = await graphFetch<{ id: string; name: string }>(pageId, { params: { fields: "id,name" }, token });
  return { id: r.id, name: r.name };
}

export async function getIgUserInfo(igUserId: string, token: string): Promise<{ id: string; username: string }> {
  const r = await graphFetch<{ id: string; username: string }>(igUserId, {
    params: { fields: "id,username" },
    token,
  });
  return { id: r.id, username: r.username };
}

// ---------------------------------------------------------------------------
// Instagram publishing quota
// ---------------------------------------------------------------------------

export async function getIgPublishingLimit(
  igUserId: string,
  token: string
): Promise<{ usage: number; total: number }> {
  const r = await graphFetch<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
    `${igUserId}/content_publishing_limit`,
    { params: { fields: "quota_usage,config" }, token }
  );
  const row = r.data?.[0];
  return { usage: row?.quota_usage ?? 0, total: row?.config?.quota_total ?? 50 };
}

// ---------------------------------------------------------------------------
// Facebook Page publishing
// ---------------------------------------------------------------------------

/** Publish a photo to a Facebook Page. Returns the created post id. */
export async function publishPagePhoto(
  pageId: string,
  opts: { imageUrl: string; message: string; token: string }
): Promise<{ postId: string; photoId?: string }> {
  const r = await graphFetch<{ id?: string; post_id?: string }>(`${pageId}/photos`, {
    method: "POST",
    params: { url: opts.imageUrl, caption: opts.message, published: true },
    token: opts.token,
  });
  return { postId: r.post_id || r.id || "", photoId: r.id };
}

/** Publish a video to a Facebook Page (v1.1). Returns the created video id. */
export async function publishPageVideo(
  pageId: string,
  opts: { fileUrl: string; description: string; token: string }
): Promise<{ videoId: string }> {
  const r = await graphFetch<{ id?: string }>(`${pageId}/videos`, {
    method: "POST",
    params: { file_url: opts.fileUrl, description: opts.description },
    token: opts.token,
  });
  return { videoId: r.id || "" };
}

// ---------------------------------------------------------------------------
// Instagram publishing (container → poll → publish)
// ---------------------------------------------------------------------------

export type IgMediaType = "IMAGE" | "STORIES" | "REELS";

/** Create an IG media container. Returns the creation_id (container id). */
export async function createIgContainer(
  igUserId: string,
  opts: {
    imageUrl?: string;
    videoUrl?: string;
    caption?: string;
    mediaType?: IgMediaType; // omit for a plain feed IMAGE
    token: string;
  }
): Promise<{ containerId: string }> {
  const params: GraphParams = { caption: opts.caption };
  if (opts.imageUrl) params.image_url = opts.imageUrl;
  if (opts.videoUrl) params.video_url = opts.videoUrl;
  if (opts.mediaType && opts.mediaType !== "IMAGE") params.media_type = opts.mediaType;
  // Stories don't take a caption.
  if (opts.mediaType === "STORIES") delete params.caption;
  const r = await graphFetch<{ id?: string }>(`${igUserId}/media`, {
    method: "POST",
    params,
    token: opts.token,
  });
  return { containerId: r.id || "" };
}

export type IgContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED";

export async function getIgContainerStatus(
  containerId: string,
  token: string
): Promise<{ status: IgContainerStatus; detail?: string }> {
  const r = await graphFetch<{ status_code?: string; status?: string }>(containerId, {
    params: { fields: "status_code,status" },
    token,
  });
  return { status: (r.status_code as IgContainerStatus) || "IN_PROGRESS", detail: r.status };
}

/** Publish a finished IG container. Returns the published media id. */
export async function publishIgContainer(
  igUserId: string,
  containerId: string,
  token: string
): Promise<{ mediaId: string }> {
  const r = await graphFetch<{ id?: string }>(`${igUserId}/media_publish`, {
    method: "POST",
    params: { creation_id: containerId },
    token,
  });
  return { mediaId: r.id || "" };
}

/** Best-effort permalink for a published post/media. Never throws. */
export async function getPermalink(objectId: string, token: string, kind: "fb" | "ig"): Promise<string | null> {
  try {
    if (kind === "ig") {
      const r = await graphFetch<{ permalink?: string }>(objectId, { params: { fields: "permalink" }, token });
      return r.permalink || null;
    }
    const r = await graphFetch<{ permalink_url?: string }>(objectId, {
      params: { fields: "permalink_url" },
      token,
    });
    return r.permalink_url ? `https://www.facebook.com${r.permalink_url}` : null;
  } catch {
    return null;
  }
}

export { GRAPH_VERSION };
