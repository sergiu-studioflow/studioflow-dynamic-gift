import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import {
  listPortalUsers,
  createUserWithPassword,
  AdminUserError,
  type PortalRole,
} from "@/lib/admin-users";

export const dynamic = "force-dynamic";

/** GET /api/admin/users — list all portal users (admin only). */
export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const users = await listPortalUsers();
  return NextResponse.json({ users });
}

/** POST /api/admin/users — create a user with a password (admin only). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.portalUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { email?: string; displayName?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const role: PortalRole = body.role === "admin" ? "admin" : "member";

  try {
    const user = await createUserWithPassword({
      email: body.email ?? "",
      displayName: body.displayName ?? "",
      password: body.password ?? "",
      role,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof AdminUserError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/users] create failed:", err);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
