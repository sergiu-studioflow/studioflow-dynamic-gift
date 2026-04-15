"use client";

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
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Brand Intelligence
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Brand knowledge base and products for {clientName}
          </p>
        </div>

        <ClientBrandIntelEditor clientSlug={clientSlug} />

        <ClientProductsTable clientSlug={clientSlug} />
      </div>
    );
  }

  // Agency-level doc (All Clients or single-brand portal)
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Brand Intelligence
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          View and manage the brand knowledge base and intelligence documents.
        </p>
      </div>

      <BrandDocSection />
    </div>
  );
}
