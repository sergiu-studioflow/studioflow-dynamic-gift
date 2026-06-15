import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
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
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminUserError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/users] password reset failed:", err);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}
