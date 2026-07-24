"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Brain,
  Lightbulb,
  Video,
  Megaphone,
  ImageIcon,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { ClientSwitcher } from "@/components/layout/client-switcher";
import { Users, Clapperboard, Target, FileText, Quote, Send } from "lucide-react";
import { useClient } from "@/lib/client-context";

// Clients that have systems enabled
const STATIC_AD_CLIENTS = ["dynamic-gift", "event-display", "indigenous-promotions", "inflatable-promotions", "lanyards-factory", "pin-factory", "promo-superstore", "the-medal-factory"];
const VIDEO_CLIENTS = ["dynamic-gift", "event-display", "indigenous-promotions", "inflatable-promotions", "lanyards-factory", "pin-factory", "promo-superstore", "the-medal-factory"];
const RESEARCH_CLIENTS = ["dynamic-gift", "event-display", "indigenous-promotions", "inflatable-promotions", "lanyards-factory", "pin-factory", "promo-superstore", "the-medal-factory"];
const REVIEW_CLIENTS = ["dynamic-gift", "event-display", "indigenous-promotions", "inflatable-promotions", "lanyards-factory", "pin-factory", "promo-superstore", "the-medal-factory"];
const POSTING_CLIENTS = ["dynamic-gift", "event-display", "indigenous-promotions", "inflatable-promotions", "lanyards-factory", "pin-factory", "promo-superstore", "the-medal-factory"];

const baseNavigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Brand Intelligence", href: "/brand-intelligence", icon: Brain },
  { name: "Content Ideation System", href: "/content-ideation", icon: Lightbulb },
  { name: "Video Brief + Script System", href: "/video-brief", icon: Video },
  { name: "Ad Copy Generation", href: "/ad-copy", icon: Megaphone },
];

type PortalSidebarProps = {
  brandName: string;
  brandColor?: string;
  features?: Record<string, boolean>;
  userEmail?: string;
};

export function PortalSidebar({ brandName, features, userEmail }: PortalSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { clientSlug } = useClient();

  // Build navigation dynamically — show systems only for enabled clients
  const navigation = [
    ...baseNavigation,
    ...(STATIC_AD_CLIENTS.includes(clientSlug) ? [{ name: "Static Ad System", href: "/static-ads", icon: ImageIcon }] : []),
    ...(VIDEO_CLIENTS.includes(clientSlug) ? [{ name: "Video Generation", href: "/video-generation", icon: Clapperboard }] : []),
    ...(RESEARCH_CLIENTS.includes(clientSlug) ? [
      { name: "Competitor Research", href: "/competitor-ads", icon: Target },
      { name: "Creative Briefs", href: "/research-briefs", icon: FileText },
    ] : []),
    ...(REVIEW_CLIENTS.includes(clientSlug) ? [{ name: "Review Graphics", href: "/review-graphics", icon: Quote }] : []),
    ...(POSTING_CLIENTS.includes(clientSlug) ? [{ name: "Post Scheduler", href: "/posting", icon: Send }] : []),
  ];

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-[260px] flex-col bg-sidebar">
      {/* Logo Section — Dynamic Gift wordmark */}
      <div className="flex h-[96px] flex-col items-center justify-center gap-1 relative px-5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,hsla(191,81%,53%,0.18)_0%,transparent_70%)] pointer-events-none" />
        <Link
          href="/dashboard"
          className="relative z-10 flex flex-col items-center gap-1 transition-all duration-200 hover:scale-[1.02]"
        >
          <Image
            src="/dynamic-gift-logo-light.png"
            alt={brandName || "Dynamic Gift"}
            width={160}
            height={56}
            priority
            className="h-auto w-[160px]"
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted">
            Creative Studio
          </span>
        </Link>
      </div>

      <div className="mx-5 h-px bg-white/10" />

      {/* Client Switcher (standardized multi-client module) */}
      {features?.multi_client && <ClientSwitcher />}

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
                  ? "bg-sidebar-active text-white shadow-xs border-l-white/30 pl-[calc(0.75rem-3px)] pr-3"
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
          {features?.multi_client && (
            <Link
              href="/clients"
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-white/10 hover:text-sidebar-foreground",
                pathname.startsWith("/clients") ? "text-sidebar-foreground" : "text-sidebar-muted"
              )}
            >
              <Users className="h-3.5 w-3.5" />
              Clients
            </Link>
          )}
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
