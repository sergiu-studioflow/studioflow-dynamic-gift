import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getApiKey } from "@/lib/api-keys";
import { GRAPH_VERSION } from "@/lib/posting/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/posting/accounts/discover
 * Lists every Facebook Page (and its linked Instagram Business account) that the
 * stored Meta System User token can publish to. Powers the "Discover from Meta"
 * button so IDs never have to be entered by hand.
 */
export async function GET(_req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const token = (await getApiKey("META_SYSTEM_USER_TOKEN")).trim();
  if (!token) {
    return NextResponse.json({ error: "META_SYSTEM_USER_TOKEN is not configured. Add it in Settings → API Keys." }, { status: 400 });
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  url.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
  url.searchParams.set("limit", "200");
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString());
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: json?.error?.message || "Graph API error" }, { status: 400 });
  }

  const pages = (json.data || []).map((p: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }) => ({
    pageId: p.id,
    pageName: p.name,
    igUserId: p.instagram_business_account?.id || null,
    igUsername: p.instagram_business_account?.username || null,
  }));

  return NextResponse.json({ pages });
}
