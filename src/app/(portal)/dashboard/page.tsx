import { Brain, Lightbulb, Video, Megaphone, ImageIcon, Target, FileText, Clapperboard } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const liveSystems = [
    {
      name: "Brand Intelligence",
      href: "/brand-intelligence",
      icon: Brain,
      description: "Brand knowledge base, positioning documents, and strategic intelligence",
    },
    {
      name: "Content Ideation System",
      href: "/content-ideation",
      icon: Lightbulb,
      description: "Generate 20-30 differentiated content ideas per batch across all 8 brands",
    },
    {
      name: "Video Brief + Script System",
      href: "/video-brief",
      icon: Video,
      description: "Production-ready video briefs with timed scripts, hook variations, and shot lists",
    },
    {
      name: "Ad Copy Generation",
      href: "/ad-copy",
      icon: Megaphone,
      description: "Complete Meta ad copy sets with multiple variations per concept for A/B testing",
    },
    {
      name: "Static Ad System",
      href: "/static-ads",
      icon: ImageIcon,
      description: "AI-powered static ad generation with reference-based creative pipeline and Kie AI",
    },
    {
      name: "Video Generation",
      href: "/video-generation",
      icon: Clapperboard,
      description: "UGC, B-Roll, and A-Roll video generation with 6-step AI pipeline and Characters Library",
    },
    {
      name: "Competitor Research",
      href: "/competitor-ads",
      icon: Target,
      description: "Track and analyze competitor ads across Meta, TikTok, and Instagram",
    },
    {
      name: "Creative Briefs",
      href: "/research-briefs",
      icon: FileText,
      description: "AI-generated creative briefs from competitor research insights",
    },
  ];

  return (
    <div className="space-y-10">
      <div className="animate-fade-up">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Dynamic Gift&apos;s AI-powered creative production systems
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {liveSystems.map((system, i) => (
          <Link
            key={system.href}
            href={system.href}
            className="card-accent animate-fade-up group relative rounded-xl border border-border bg-card p-7 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 hover:border-primary/20"
            style={{ animationDelay: `${(i + 1) * 80}ms` }}
          >
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/30 via-primary/80 to-primary/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-t-xl" />
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <system.icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                  {system.name}
                </h2>
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
