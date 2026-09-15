import { PortalShell } from "@/components/layout/portal-shell";
import { NoAccessScreen } from "@/components/layout/no-access-screen";
import { getAppConfig } from "@/lib/config";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    // The cookie no longer maps to a session. Expire it on the way to /login — a layout
    // can't touch cookies, and a leftover cookie is what kept users out after a password change.
    redirect("/login/clear-session");
  }

  // Same rule as requireAuth(): a valid login without an active portal user gets no access.
  const [portalUser] = await db
    .select({ isActive: schema.users.isActive, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.userId, session.user.id))
    .limit(1);

  if (!portalUser?.isActive) {
    return <NoAccessScreen email={session.user.email} deactivated={!!portalUser} />;
  }

  const config = await getAppConfig();

  return (
    <PortalShell config={config} userEmail={session.user?.email} role={portalUser.role}>
      {children}
    </PortalShell>
  );
}
