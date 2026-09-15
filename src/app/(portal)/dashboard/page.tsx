import Image from "next/image";
import { SystemsGrid } from "./systems-grid";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
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

      {/* System grid — gated per brand, like the sidebar */}
      <SystemsGrid />
    </div>
  );
}
