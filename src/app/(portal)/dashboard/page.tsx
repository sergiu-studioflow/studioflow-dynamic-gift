import Image from "next/image";
import { Brain, Lightbulb, Video, Megaphone, ImageIcon, Target, FileText, Clapperboard } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const systems = [
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
      description:
        "On-brand static ads from a curated reference library — Dynamic Gift cyan, real product photography, ready for paid social.",
    },
    {
      name: "Video Generation",
      href: "/video-generation",
      icon: Clapperboard,
      description:
        "UGC, B-Roll, and A-Roll videos rendered end-to-end — script in, finished MP4 out, scoped to promo-product use cases.",
    },
    {
      name: "Competitor Research",
      href: "/competitor-ads",
      icon: Target,
      description:
        "See what other promo-product suppliers are running across Meta, TikTok, and Instagram — all in one feed.",
    },
    {
      name: "Creative Briefs",
      href: "/research-briefs",
      icon: FileText,
      description:
        "Strategic creative briefs distilled from competitor research, ready to hand to copy + design.",
    },
  ];

  return (
    <div className="space-y-10">
      {/* Branded hero strip */}
      <section className="card-accent animate-fade-up relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-secondary/40 to-background p-8 shadow-card">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_30%,hsla(191,81%,53%,0.14)_0%,transparent_70%)] pointer-events-none" />
        <div className="relative z-10 flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <div className="hidden md:flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-card shadow-card ring-1 ring-primary/15">
              <Image
                src="/dynamic-gift-emblem.png"
                alt="Dynamic Gift"
                width={56}
                height={56}
                priority
                className="h-14 w-14 rounded-xl"
              />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                Dynamic Gift
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                <span className="font-display text-primary">Creative Studio</span>
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Dynamic Gift&apos;s creative ops studio — brand intel, ideas, briefs, copy, and AI-generated creative across 10,000+ promotional products.
              </p>
            </div>
          </div>
          <div className="hidden md:block">
            <Image
              src="/dynamic-gift-logo.png"
              alt="Dynamic Gift wordmark"
              width={200}
              height={70}
              priority
              className="h-auto w-[200px] opacity-90 dark:hidden"
            />
            <Image
              src="/dynamic-gift-logo-light.png"
              alt="Dynamic Gift wordmark"
              width={200}
              height={70}
              priority
              className="hidden h-auto w-[200px] opacity-90 dark:block"
            />
          </div>
        </div>
      </section>

      {/* System grid */}
      <div>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Systems
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((system, i) => (
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
    </div>
  );
}
