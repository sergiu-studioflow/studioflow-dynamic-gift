"use client";

import { PortalSidebar } from "./portal-sidebar";
import type { AppConfig } from "@/lib/types";

type PortalShellProps = {
  children: React.ReactNode;
  config: AppConfig | null;
  userEmail?: string;
};

export function PortalShell({ children, config, userEmail }: PortalShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PortalSidebar
        brandName={config?.brandName || "Client Portal"}
        brandColor={config?.brandColor || undefined}
        features={config?.features}
        userEmail={userEmail}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-10 py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
