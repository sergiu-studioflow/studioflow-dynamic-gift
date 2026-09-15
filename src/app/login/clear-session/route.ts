import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Better Auth's cookie names, with and without the secure-cookie prefix. Only used if its own
// sign-out can't produce the expiring Set-Cookie headers.
const SESSION_COOKIES = [
  "better-auth.session_token",
  "better-auth.session_data",
  "better-auth.dont_remember",
  "__Secure-better-auth.session_token",
  "__Secure-better-auth.session_data",
  "__Secure-better-auth.dont_remember",
];

/**
 * GET /login/clear-session
 *
 * Where the portal layout sends a request whose session cookie no longer maps to a session
 * (password changed on another device, sessions revoked, user deleted and re-created). A
 * server component can't change cookies, so the stale cookie is expired here and the browser
 * continues to /login with a clean slate.
 *
 * A session that still validates is left alone (→ /dashboard), so a link to this URL can't
 * sign anyone out; if validity can't be checked right now, nothing is cleared either.
 */
export async function GET(request: NextRequest) {
  const login = new URL("/login", request.url);

  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: request.headers });
  } catch {
    return NextResponse.redirect(login);
  }
  if (session) return NextResponse.redirect(new URL("/dashboard", request.url));

  const response = NextResponse.redirect(login);
  try {
    const { headers } = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
    const cookies = headers?.getSetCookie() ?? [];
    if (!cookies.length) throw new Error("sign-out returned no cookies");
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  } catch {
    for (const name of SESSION_COOKIES) {
      response.cookies.set(name, "", { maxAge: 0, path: "/", httpOnly: true, sameSite: "lax", secure: name.startsWith("__Secure-") });
    }
  }
  return response;
}
