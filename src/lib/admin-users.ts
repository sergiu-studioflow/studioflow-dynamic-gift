import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Admin user management
// ─────────────────────────────────────────────────────────────────────────────
// Direct-DB helpers that mirror Better Auth's credential-account shape so that
// `authClient.signIn.email(...)` accepts accounts we create here. We use Better
// Auth's own `hashPassword` (default scrypt) — the exact hasher its email+password
// sign-in verifies against — so seeded/created passwords work without any plugin.
//
// Role lives only on the portal `users` table (admin | member). There is no
// second source of truth. An admin's ONLY extra power is the /admin/users area
// (these routes gate on `portalUser.role`); every other portal action is the
// same for admins and members.

export type PortalRole = "admin" | "member";

export class AdminUserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminUserError";
    this.status = status;
  }
}

function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

export type AdminUserRow = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export async function listPortalUsers(): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      userId: schema.users.userId,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      isActive: schema.users.isActive,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .orderBy(schema.users.createdAt);
  return rows;
}

/** Count active admins. Used to guard the "last admin" invariant. */
export async function countActiveAdmins(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), eq(schema.users.isActive, true)));
  return row?.count ?? 0;
}

/** Look up a portal user by its `users.id` (the public row id, not the auth id). */
export async function getPortalUserById(id: string): Promise<AdminUserRow | null> {
  const [row] = await db
    .select({
      id: schema.users.id,
      userId: schema.users.userId,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      isActive: schema.users.isActive,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Create a brand-new portal user with a password credential, in one transaction:
 *   authUser → authAccount(credential) → portal users row.
 * Throws AdminUserError(409) on duplicate email.
 */
export async function createUserWithPassword(input: {
  email: string;
  displayName: string;
  password: string;
  role: PortalRole;
}): Promise<AdminUserRow> {
  const email = normalizeEmail(input.email);
  const displayName = (input.displayName || "").trim() || email.split("@")[0] || "User";
  if (!email.includes("@")) throw new AdminUserError("A valid email is required.", 400);
  if (!input.password || input.password.length < 8)
    throw new AdminUserError("Password must be at least 8 characters.", 400);
  if (input.role !== "admin" && input.role !== "member")
    throw new AdminUserError("Role must be admin or member.", 400);

  const [existingAuth] = await db
    .select({ id: schema.authUser.id })
    .from(schema.authUser)
    .where(eq(schema.authUser.email, email))
    .limit(1);
  if (existingAuth) throw new AdminUserError("A user with that email already exists.", 409);

  const userId = randomUUID();
  const now = new Date();
  const hashed = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    await tx.insert(schema.authUser).values({
      id: userId,
      name: displayName,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(schema.authAccount).values({
      id: randomUUID(),
      accountId: userId, // Better Auth convention: credential accountId === user id
      providerId: "credential",
      userId,
      password: hashed,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await tx
      .insert(schema.users)
      .values({
        userId,
        displayName,
        email,
        role: input.role,
        isActive: true,
      })
      .returning({
        id: schema.users.id,
        userId: schema.users.userId,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
        isActive: schema.users.isActive,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
      });

    return created;
  });
}

/**
 * Set (or reset) a user's password by Better Auth user id. Upserts the credential
 * account so it also works for users who currently only have a magic-link identity.
 */
export async function setCredentialPassword(userId: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8)
    throw new AdminUserError("Password must be at least 8 characters.", 400);

  const hashed = await hashPassword(newPassword);
  const now = new Date();

  const [existing] = await db
    .select({ id: schema.authAccount.id })
    .from(schema.authAccount)
    .where(and(eq(schema.authAccount.userId, userId), eq(schema.authAccount.providerId, "credential")))
    .limit(1);

  if (existing) {
    await db
      .update(schema.authAccount)
      .set({ password: hashed, updatedAt: now })
      .where(eq(schema.authAccount.id, existing.id));
  } else {
    await db.insert(schema.authAccount).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: hashed,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Hard-delete a user. Deleting the Better Auth user cascades its sessions,
 * accounts, and the portal `users` row (FK onDelete: cascade).
 */
export async function deleteUserByAuthId(userId: string): Promise<void> {
  await db.delete(schema.authUser).where(eq(schema.authUser.id, userId));
}

/** Update a portal user's role and/or active flag. */
export async function updatePortalUser(
  id: string,
  patch: { role?: PortalRole; isActive?: boolean },
): Promise<AdminUserRow> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.role !== undefined) {
    if (patch.role !== "admin" && patch.role !== "member")
      throw new AdminUserError("Role must be admin or member.", 400);
    set.role = patch.role;
  }
  if (patch.isActive !== undefined) set.isActive = patch.isActive;

  const [updated] = await db
    .update(schema.users)
    .set(set)
    .where(eq(schema.users.id, id))
    .returning({
      id: schema.users.id,
      userId: schema.users.userId,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      isActive: schema.users.isActive,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    });
  if (!updated) throw new AdminUserError("User not found.", 404);
  return updated;
}
