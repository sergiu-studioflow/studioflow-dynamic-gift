"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Building2, Plus, Globe, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Client } from "@/lib/types";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(setClients)
      .finally(() => setLoading(false));
  }, []);

  const activeClients = clients.filter((c) => c.status === "Active");
  const pausedClients = clients.filter((c) => c.status === "Paused");
  const archivedClients = clients.filter((c) => c.status === "Archived");

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-border/50 bg-card" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeClients.length} active client{activeClients.length !== 1 ? "s" : ""}
            {pausedClients.length > 0 && ` · ${pausedClients.length} paused`}
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary,#b2ff00)] px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add Client
        </Link>
      </div>

      {/* Client Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Add Client CTA card */}
        <Link
          href="/clients/new"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/50 bg-card/30 p-8 transition-all hover:border-border hover:bg-card/50"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Plus className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">Add New Client</span>
        </Link>

        {/* Active clients */}
        {activeClients.map((client) => (
          <ClientCard key={client.id} client={client} />
        ))}

        {/* Paused clients */}
        {pausedClients.map((client) => (
          <ClientCard key={client.id} client={client} dimmed />
        ))}
      </div>

      {/* Archived section */}
      {archivedClients.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Archived ({archivedClients.length})
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archivedClients.map((client) => (
              <ClientCard key={client.id} client={client} dimmed />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClientCard({ client, dimmed }: { client: Client; dimmed?: boolean }) {
  return (
    <Link
      href={`/clients/${client.clientSlug}`}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-border hover:shadow-sm",
        dimmed && "opacity-60"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        {client.logoUrl ? (
          <img src={client.logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold"
            style={{
              backgroundColor: client.brandColor ? `${client.brandColor}15` : "hsl(var(--muted))",
              color: client.brandColor || "hsl(var(--muted-foreground))",
            }}
          >
            {client.clientName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="truncate font-medium">{client.clientName}</h3>
          {client.category && (
            <p className="text-xs text-muted-foreground">{client.category}</p>
          )}
        </div>
        <StatusBadge status={client.status} />
      </div>

      {/* Details */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {client.website && (
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {client.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </span>
        )}
        {client.primaryMarket && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {client.primaryMarket}
          </span>
        )}
      </div>

      {/* Cluster badge */}
      {client.cluster && (
        <span className="inline-flex w-fit rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {client.cluster}
        </span>
      )}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    Paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    Archived: "bg-gray-500/15 text-gray-500",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", colors[status] || colors.Active)}>
      {status}
    </span>
  );
}
