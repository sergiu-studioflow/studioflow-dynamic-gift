import { requireAuth, isAuthError } from "@/lib/auth";
import { PortalRoleProvider } from "@/components/clients/portal-role";

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  // The portal layout has already redirected signed-out users. A session without an
  // active portal user gets no admin actions (the routes would refuse them anyway).
  const auth = await requireAuth();
  const role = isAuthError(auth) ? "viewer" : auth.portalUser.role;

  return <PortalRoleProvider role={role}>{children}</PortalRoleProvider>;
}
