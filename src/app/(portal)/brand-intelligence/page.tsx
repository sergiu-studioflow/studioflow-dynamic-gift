"use client";

import Image from "next/image";
import { Brain, Building2 } from "lucide-react";
import { BrandDocSection } from "@/components/brand-intel/brand-doc-section";
import { ClientBrandIntelEditor } from "@/components/clients/client-brand-intel-editor";
import { ClientProductsTable } from "@/components/clients/client-products-table";
import { useClient } from "@/lib/client-context";

export default function BrandIntelligencePage() {
  const { isMultiClient, isAllClients, clientName, clientSlug } = useClient();

  // Multi-client mode with a client selected: show that client's brand intel + products
  if (isMultiClient && !isAllClients) {
    return (
      <div className="space-y-8">
        <section className="card-accent animate-fade-up relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-secondary/40 to-background p-5 shadow-card">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_85%_30%,hsla(191,81%,53%,0.14)_0%,transparent_70%)] pointer-events-none" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-card shadow-card ring-1 ring-primary/15">
              <Image
                src="/dynamic-gift-emblem.png"
                alt="Dynamic Gift"
                width={40}
                height={40}
                priority
                className="h-10 w-10 rounded-lg"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                <Brain className="h-3 w-3" />
                {clientName} · Brand Context
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                <span className="font-display text-primary">Brand Intelligence</span>
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Source of truth for every AI in this studio — {clientName}&apos;s voice, customer language, products, and proof. Edit once, every generation downstream picks it up.
              </p>
            </div>
          </div>
        </section>

        <ClientBrandIntelEditor clientSlug={clientSlug} />

        <ClientProductsTable clientSlug={clientSlug} />
      </div>
    );
  }

  // Agency-level / All Clients view
  return (
    <div className="space-y-8">
      <section className="card-accent animate-fade-up relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-secondary/40 to-background p-5 shadow-card">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_85%_30%,hsla(191,81%,53%,0.14)_0%,transparent_70%)] pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-card shadow-card ring-1 ring-primary/15">
            <Image
              src="/dynamic-gift-emblem.png"
              alt="Dynamic Gift"
              width={40}
              height={40}
              priority
              className="h-10 w-10 rounded-lg"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
              <Brain className="h-3 w-3" />
              Dynamic Gift
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              <span className="font-display text-primary">Brand Intelligence</span>
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Each client&apos;s voice, customer language, products, and proof — the source of truth every AI system reads. Pick a client from the sidebar to view or edit theirs.
            </p>
          </div>
        </div>
      </section>

      {isMultiClient ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Pick a client to view their brand intel</h2>
          <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
            Use the client switcher in the sidebar to select a brand. Each client&apos;s intelligence document and products live here.
          </p>
        </div>
      ) : (
        <BrandDocSection />
      )}
    </div>
  );
}
