import { NextRequest } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";

/**
 * Auth for cron routes. Accepts EITHER:
 *   - a valid `Authorization: Bearer <CRON_SECRET>` header (Vercel Cron / external scheduler), OR
 *   - an authenticated portal session (so admins can trigger a run manually from the UI).
 *
 * Returns true if allowed. Cron routes are also allowlisted in middleware so the
 * scheduler's cookie-less request isn't bounced to /login.
 */
export async function isAuthorizedCron(req: NextRequest): Promise<boolean> {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (secret) {
    const header = req.headers.get("authorization") || "";
    if (header === `Bearer ${secret}`) return true;
  }
  const auth = await requireAuth();
  return !isAuthError(auth);
}
