"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Target, Brain, Package, Loader2 } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { ClientBrandIntelEditor } from "@/components/clients/client-brand-intel-editor";
import { ClientProductsTable } from "@/components/clients/client-products-table";
import type { Client } from "@/lib/types";

type Tab = "overview" | "brand-intel" | "products";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: Target },
  { key: "brand-intel", label: "Brand Intel", icon: Brain },
  { key: "products", label: "Products", icon: Package },
];

export default function ClientDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [client, setClient] = useState<Client | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/clients/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setClient)
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-4">
        <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Clients
        </Link>
        <p className="text-muted-foreground">Client not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/clients" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Clients
        </Link>
        <div className="flex items-start gap-4">
          {client.logoUrl ? (
            <img src={client.logoUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold"
              style={{
                backgroundColor: client.brandColor ? `${client.brandColor}15` : "hsl(var(--muted))",
                color: client.brandColor || "hsl(var(--muted-foreground))",
              }}
            >
              {client.clientName.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{client.clientName}</h1>
            <p className="text-sm text-muted-foreground">
              {[client.category, client.primaryMarket].filter(Boolean).join(" · ") || client.clientSlug}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50 pb-px">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground/80"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && <OverviewTab client={client} />}
      {tab === "brand-intel" && <ClientBrandIntelEditor clientSlug={slug} />}
      {tab === "products" && <ClientProductsTable clientSlug={slug} />}
    </div>
  );
}

function OverviewTab({ client }: { client: Client }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-border/50 bg-card p-5">
        <h3 className="font-medium">Client Details</h3>
        <dl className="space-y-3 text-sm">
          <Row label="Name" value={client.clientName} />
          <Row label="Slug" value={client.clientSlug || "—"} mono />
          {client.website && <Row label="Website" value={client.website} />}
          {client.category && <Row label="Category" value={client.category} />}
          {client.primaryMarket && <Row label="Market" value={client.primaryMarket} />}
          {client.currency && <Row label="Currency" value={client.currency} />}
          <Row label="Status" value={client.status} />
          {client.createdAt && <Row label="Created" value={formatDate(client.createdAt)} />}
        </dl>
      </div>

      <div className="space-y-4 rounded-xl border border-border/50 bg-card p-5">
        <h3 className="font-medium">Storage & Infrastructure</h3>
        <dl className="space-y-3 text-sm">
          <Row label="Storage Prefix" value={client.storagePrefix} mono />
          {client.brandColor && <Row label="Brand Color" value={client.brandColor} />}
          <Row label="Provisioned" value={client.provisionedAt ? formatDate(client.provisionedAt) : "Pending"} />
        </dl>
        {client.notes && (
          <div className="mt-4 border-t border-border/50 pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
            <p className="text-sm">{client.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}
