import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import {
  getPortalUserById,
  deleteUserByAuthId,
  updatePortalUser,
  countActiveAdmins,
  AdminUserError,
  type PortalRole,
} from "@/lib/admin-users";

export const dynamic = "force-dynamic";

/** DELETE /api/admin/users/[id] — hard-delete a user (admin only). */
export async function DELETE(
  _req: NextRequest,
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

  if (target.userId === auth.user.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }
  if (target.role === "admin" && target.isActive && (await countActiveAdmins()) <= 1) {
    return NextResponse.json({ error: "Cannot delete the last remaining admin." }, { status: 400 });
  }

  await deleteUserByAuthId(target.userId);
  return NextResponse.json({ ok: true });
}

/** PATCH /api/admin/users/[id] — change role and/or active status (admin only). */
export async function PATCH(
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

  let body: { role?: string; isActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: { role?: PortalRole; isActive?: boolean } = {};
  if (body.role !== undefined) patch.role = body.role === "admin" ? "admin" : "member";
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
  if (patch.role === undefined && patch.isActive === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Guard the last-active-admin invariant: block any change that would remove the
  // only active admin from the admin set (covers self-demotion / self-deactivation).
  const newRole = patch.role ?? (target.role as PortalRole);
  const newActive = patch.isActive ?? target.isActive;
  const wasActiveAdmin = target.role === "admin" && target.isActive;
  const willBeActiveAdmin = newRole === "admin" && newActive;
  if (wasActiveAdmin && !willBeActiveAdmin && (await countActiveAdmins()) <= 1) {
    return NextResponse.json(
      { error: "Cannot remove the last remaining admin." },
      { status: 400 },
    );
  }

  try {
    const user = await updatePortalUser(id, patch);
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof AdminUserError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/users] update failed:", err);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
