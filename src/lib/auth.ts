import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "",
    process.env.NEXT_PUBLIC_APP_URL ?? "",
  ].filter(Boolean),

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.authUser,
      session: schema.authSession,
      account: schema.authAccount,
      verification: schema.authVerification,
    },
  }),

  // Email + password only — no magic link, no email service (Resend) in the
  // login path. Self-signup is disabled: accounts exist only because an admin
  // created them in /admin/users (or the seed script). Passwords are verified
  // against the `account` credential rows hashed with better-auth/crypto.
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
  },

  databaseHooks: {
    session: {
      create: {
        // users.last_login_at (shown in Settings and User management) is ours, not Better
        // Auth's, so nothing wrote it. Only sign-ins count: Better Auth also creates a
        // session when a password change revokes the others.
        after: async (session, ctx) => {
          if (ctx?.path && !ctx.path.startsWith("/sign-in")) return;
          try {
            await db
              .update(schema.users)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.users.userId, session.userId));
          } catch (err) {
            // Never fail a sign-in over a bookkeeping column.
            console.warn("[auth] could not record last login:", err);
          }
        },
      },
    },
  },
});

// =============================================
// requireAuth — use in all protected API routes
// =============================================

export type PortalUser = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
};

export type AuthResult = {
  user: { id: string; email?: string };
  portalUser: PortalUser;
  /** The Better Auth session making this request. */
  sessionId: string;
};

export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [portalUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.userId, session.user.id))
    .limit(1);

  // No auto-provisioning. A portal account exists only because an admin created
  // it (or the seed script did) — a valid session without an active `users` row
  // gets no access. This permanently closes the "first login becomes admin" hole.
  if (!portalUser || !portalUser.isActive) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  return {
    user: { id: session.user.id, email: session.user.email },
    portalUser,
    sessionId: session.session.id,
  };
}

export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
