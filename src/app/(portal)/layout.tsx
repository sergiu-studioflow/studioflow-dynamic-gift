import { PortalShell } from "@/components/layout/portal-shell";
import { getAppConfig } from "@/lib/config";
import { auth } from "@/lib/auth";
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
    redirect("/login");
  }

  const config = await getAppConfig();

  return (
    <PortalShell config={config} userEmail={session.user?.email}>
      {children}
    </PortalShell>
  );
}
