"use client";

import Link from "next/link";
import {
  Brain,
  Lightbulb,
  Video,
  Megaphone,
  ImageIcon,
  Target,
  FileText,
  Clapperboard,
  Quote,
  Send,
  CalendarRange,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useClient } from "@/lib/client-context";
import { useClientCapabilities, type Capabilities } from "@/components/layout/use-client-capabilities";

type System = {
  name: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** Shown only when the selected brand has this capability — the same gate the sidebar uses. */
  requires?: keyof Capabilities;
};

// Same order as the sidebar.
const SYSTEMS: System[] = [
  {
    name: "Brand Intelligence",
    href: "/brand-intelligence",
    icon: Brain,
    description:
      "The single source of truth our creative AIs read — Dynamic Gift's voice, customer language, product range, and proof points.",
  },
  {
    name: "Content Ideation System",
    href: "/content-ideation",
    icon: Lightbulb,
    description:
      "Spin up batches of promo-product content ideas — angles that work for lanyards, drink bottles, apparel, tech, and inflatables alike.",
  },
  {
    name: "Video Brief + Script System",
    href: "/video-brief",
    icon: Video,
    description:
      "Shoot-ready video briefs with timed scripts, multiple hooks, and shot lists — built for B2B decision-makers who order in volume.",
  },
  {
    name: "Ad Copy Generation",
    href: "/ad-copy",
    icon: Megaphone,
    description:
      "Meta ad copy sets tuned to the Aussie corporate-gifting buyer — price + speed + free design, multiple variations per concept.",
  },
  {
    name: "Static Ad System",
    href: "/static-ads",
    icon: ImageIcon,
    requires: "staticAds",
    description:
      "On-brand static ads from a curated reference library — Dynamic Gift cyan, real product photography, ready for paid social.",
  },
  {
    name: "Video Generation",
    href: "/video-generation",
    icon: Clapperboard,
    requires: "video",
    description:
      "UGC, B-Roll, and A-Roll videos rendered end-to-end — script in, finished MP4 out, scoped to promo-product use cases.",
  },
  {
    name: "Competitor Research",
    href: "/competitor-ads",
    icon: Target,
    requires: "research",
    description:
      "See what other promo-product suppliers are running across Meta, TikTok, and Instagram — all in one feed.",
  },
  {
    name: "Creative Briefs",
    href: "/research-briefs",
    icon: FileText,
    requires: "briefs",
    description:
      "Strategic creative briefs distilled from competitor research, ready to hand to copy + design.",
  },
  {
    name: "Review Graphics",
    href: "/review-graphics",
    icon: Quote,
    requires: "reviews",
    description:
      "Real Google reviews turned into on-brand social graphics — pulled, filtered and designed for the brand.",
  },
  {
    name: "Post Scheduler",
    href: "/posting",
    icon: Send,
    requires: "posting",
    description:
      "Queue approved creative for Facebook and Instagram and let it publish on schedule.",
  },
  {
    name: "Monthly Planning",
    href: "/monthly-planning",
    icon: CalendarRange,
    requires: "monthlyPlanning",
    description:
      "Plan a month of content, generate the creative for each slot, and schedule it in one flow.",
  },
  {
    name: "Quality Control",
    href: "/quality-control",
    icon: ShieldCheck,
    requires: "qualityControl",
    description:
      "Every generated piece is checked against the brand's standards — anything that fails is held for your review.",
  },
];

export function SystemsGrid() {
  const { clientId, clientName, isMultiClient } = useClient();
  const caps = useClientCapabilities();
  const visible = SYSTEMS.filter((s) => !s.requires || !!caps?.[s.requires]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Systems{isMultiClient && clientId ? ` · ${clientName}` : ""}
        </h2>
        {isMultiClient && !clientId ? (
          <p className="text-xs text-muted-foreground">
            Pick a brand in the sidebar to see every system set up for it.
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((system, i) => (
          <Link
            key={system.href}
            href={system.href}
            className="card-accent animate-fade-up group relative rounded-xl border border-border bg-card p-7 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 hover:border-primary/30"
            style={{ animationDelay: `${(i + 1) * 80}ms` }}
          >
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/30 via-primary/80 to-primary/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-t-xl" />
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <system.icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold tracking-tight text-foreground">
                  {system.name}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {system.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
