import { Brain, Lightbulb, Sparkles, Lock } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE NOTE: Add system cards here when migrating new systems into the
// portal. Copy the live card pattern below and add the system route + icon.
// Planned/future systems use the locked card pattern.
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const liveSystems = [
    {
      name: "Brand Intelligence",
      href: "/brand-intelligence",
      icon: Brain,
      description: "Brand knowledge base, positioning documents, and strategic intelligence",
    },
    {
      name: "Content Ideation",
      href: "/content-ideation",
      icon: Lightbulb,
      description: "Generate 20-30 differentiated content ideas per batch across all 8 brands",
    },
  ];

  const plannedSystems = [
    // Placeholder — replace with real system cards after migration
    {
      name: "Coming Soon",
      icon: Sparkles,
      description: "Your next AI-powered system will appear here",
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

        {plannedSystems.map((system, i) => (
          <div
            key={system.name}
            className="animate-fade-up relative rounded-xl border border-border bg-card p-7 select-none"
            style={{ animationDelay: `${(liveSystems.length + i + 1) * 80}ms` }}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl gap-1.5 z-10">
              <Lock className="h-4 w-4 text-muted-foreground/60" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Planned
              </span>
            </div>
            <div className="flex items-start gap-4 opacity-30 blur-[2px] pointer-events-none">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
                <system.icon className="h-6 w-6 text-muted-foreground" />
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
          </div>
        ))}
      </div>
    </div>
  );
}
