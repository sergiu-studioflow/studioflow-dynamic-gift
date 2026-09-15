"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The signed-in user's portal role (admin / member / viewer), for pages under /clients.
 *
 * Provided by app/(portal)/clients/layout.tsx, which reads it server-side. The API
 * routes still authorise every request; this only lets the pages hide actions the
 * server would refuse, instead of letting a member run a whole flow into a 403.
 */
const PortalRoleContext = createContext<string | null>(null);

export function PortalRoleProvider({ role, children }: { role: string; children: ReactNode }) {
  return <PortalRoleContext.Provider value={role}>{children}</PortalRoleContext.Provider>;
}

export function usePortalRole(): string {
  const role = useContext(PortalRoleContext);
  if (role === null) throw new Error("usePortalRole() must be used under the /clients layout");
  return role;
}
