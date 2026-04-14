import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { Settings, User, Shield , Key } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { ApiKeysManager } from "@/components/settings/api-keys-manager";

export const dynamic = "force-dynamic";

async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) return null;

  const [portalUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.userId, session.user.id))
    .limit(1);

  return {
    authUser: session.user,
    portalUser: portalUser || null,
  };
}

export default async function SettingsPage() {
  const userData = await getCurrentUser();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Account settings and preferences
        </p>
      </div>

      {/* User Profile */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Profile</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Email</p>
            <p className="mt-1 text-sm text-foreground">
              {userData?.authUser?.email || "--"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Display Name</p>
            <p className="mt-1 text-sm text-foreground">
              {userData?.portalUser?.displayName || "--"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Role</p>
            <p className="mt-1 text-sm capitalize text-foreground">
              {userData?.portalUser?.role || "--"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Last Login</p>
            <p className="mt-1 text-sm text-foreground">
              {userData?.portalUser?.lastLoginAt
                ? formatDateTime(userData.portalUser.lastLoginAt)
                : "--"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Member Since</p>
            <p className="mt-1 text-sm text-foreground">
              {userData?.portalUser?.createdAt
                ? formatDateTime(userData.portalUser.createdAt)
                : "--"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Account Status</p>
            <p className="mt-1 text-sm text-foreground">
              {userData?.portalUser?.isActive ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Active
                </span>
              ) : (
                <span className="text-muted-foreground">--</span>
              )}
            </p>
          </div>
        </div>
      </div>

      
      {/* API Keys */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Key className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">API Keys</h2>
          <span className="text-xs text-muted-foreground ml-auto">AI service credentials</span>
        </div>
        <div className="p-5">
          <ApiKeysManager />
        </div>
      </div>
      {/* Security */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Security</h2>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground">
            Authentication is managed via magic link. No password is required.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Auth provider: <span className="font-medium text-foreground">Better Auth (magic link via Resend)</span>
          </p>
        </div>
      </div>

      {/* Notification Preferences Placeholder */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground">
            Notification preferences coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
