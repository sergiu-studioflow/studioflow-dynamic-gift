import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Auth for cron routes. Accepts EITHER:
 *   - a valid `Authorization: Bearer <CRON_SECRET>` header (Vercel Cron / external scheduler), OR
 *   - an authenticated ADMIN session (so an admin can trigger a run manually from the UI).
 *
 * Crons publish posts, spend model credits and sweep shared state, so a member or viewer
 * session is not enough.
 *
 * Returns true if allowed. Cron routes are also allowlisted in middleware so the
 * scheduler's cookie-less request isn't bounced to /login.
 */
export async function isAuthorizedCron(req: NextRequest): Promise<boolean> {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (secret) {
    const header = req.headers.get("authorization") || "";
    if (sameSecret(header, `Bearer ${secret}`)) return true;
  }
  const auth = await requireAuth();
  return !isAuthError(auth) && auth.portalUser.role === "admin";
}
