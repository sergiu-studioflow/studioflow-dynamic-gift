import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getPortalUserById, setCredentialPassword, AdminUserError } from "@/lib/admin-users";

export const dynamic = "force-dynamic";

/** POST /api/admin/users/[id]/password — admin resets a user's password. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const target = await getPortalUserById(id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let body: { newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await setCredentialPassword(target.userId, body.newPassword ?? "");
  } catch (err) {
    if (err instanceof AdminUserError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/users] password reset failed:", err);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }

  // A reset usually answers a forgotten or compromised password, so every existing session
  // for that account ends here — otherwise whoever held the old password stays signed in.
  // An admin resetting their own password keeps the session they're using.
  try {
    const revoked = await db
      .delete(schema.authSession)
      .where(
        target.userId === auth.user.id
          ? and(eq(schema.authSession.userId, target.userId), ne(schema.authSession.id, auth.sessionId))
          : eq(schema.authSession.userId, target.userId),
      )
      .returning({ id: schema.authSession.id });
    return NextResponse.json({ ok: true, sessionsRevoked: revoked.length });
  } catch (err) {
    console.error("[admin/users] password reset: revoking sessions failed:", err);
    return NextResponse.json(
      { error: "The password was changed, but existing sessions could not be signed out. Try the reset again." },
      { status: 500 },
    );
  }
}
