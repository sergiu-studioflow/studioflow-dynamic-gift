"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Brain,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE NOTE: Add new navigation items here when migrating systems.
// Copy the nav item pattern and add the route + icon.
// ─────────────────────────────────────────────────────────────────────────────

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Brand Intelligence", href: "/brand-intelligence", icon: Brain },
  // ADD SYSTEM NAV ITEMS HERE DURING MIGRATE
];

type PortalSidebarProps = {
  brandName: string;
  brandColor?: string;
  features?: Record<string, boolean>;
  userEmail?: string;
};

export function PortalSidebar({ brandName, userEmail }: PortalSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-[260px] flex-col bg-sidebar">
      {/* Logo Section — StudioFlow × Client */}
      <div className="flex h-[80px] items-center justify-center relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,hsla(79,100%,50%,0.08)_0%,transparent_70%)] pointer-events-none" />
        <div className="flex items-center gap-3 relative z-10">
          <div className="group/sf rounded-xl transition-all duration-200 hover:scale-105 hover:shadow-[0_0_16px_rgba(178,255,0,0.25)]">
            <Image
              src="/studioflow-logo.png"
              alt="StudioFlow"
              width={40}
              height={40}
              className="rounded-xl transition-all duration-200 group-hover/sf:brightness-110"
            />
          </div>
          <span className="text-sm font-light text-sidebar-muted">×</span>
          <div className="group/cl rounded-xl transition-all duration-200 hover:scale-105">
            <Image
              src="/client-logo.png"
              alt={brandName}
              width={40}
              height={40}
              className="rounded-xl transition-all duration-200 group-hover/cl:brightness-110"
            />
          </div>
        </div>
      </div>

      <div className="mx-5 h-px bg-white/10" />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150 border-l-[3px]",
                "py-3",
                isActive
                  ? "bg-sidebar-active text-black shadow-xs border-l-black/20 pl-[calc(0.75rem-3px)] pr-3"
                  : "text-white/55 hover:text-white hover:bg-white/10 border-l-transparent pl-[calc(0.75rem-3px)] pr-3"
              )}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="space-y-3 border-t border-white/10 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">Theme</span>
          <ThemeToggle variant="sidebar" />
        </div>

        {userEmail && (
          <p className="truncate text-[12px] font-medium text-white/45">
            {userEmail}
          </p>
        )}
        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Link>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-muted transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
