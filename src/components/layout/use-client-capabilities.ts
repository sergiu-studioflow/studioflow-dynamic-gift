"use client";

import { useEffect, useState } from "react";
import { useClient } from "@/lib/client-context";

/**
 * Which systems the selected brand is set up to run — GET /api/clients/[slug]/capabilities
 * (see lib/client-capabilities.ts). Shared by the sidebar and the dashboard so the two can't
 * disagree about what a brand has.
 */
export type Capabilities = {
  staticAds: boolean;
  video: boolean;
  research: boolean;
  briefs: boolean;
  reviews: boolean;
  posting: boolean;
  monthlyPlanning: boolean;
  qualityControl: boolean;
};

// Sidebar and dashboard mount together: one request per brand, reused for a minute.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<Capabilities | null> }>();

function fetchCapabilities(slug: string): Promise<Capabilities | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetch(`/api/clients/${encodeURIComponent(slug)}/capabilities`)
    .then((r) => (r.ok ? (r.json() as Promise<Capabilities>) : null))
    .catch(() => null);
  cache.set(slug, { at: Date.now(), promise });
  // Don't hold on to a failure for the whole TTL.
  promise.then((caps) => {
    if (!caps) cache.delete(slug);
  });
  return promise;
}

/**
 * The selected brand's capabilities, or null while they load and whenever no brand is
 * selected ("All Clients") — never the previous brand's.
 */
export function useClientCapabilities(): Capabilities | null {
  const { clientSlug } = useClient();
  const [loaded, setLoaded] = useState<{ slug: string; caps: Capabilities | null } | null>(null);

  useEffect(() => {
    if (!clientSlug) return;
    let cancelled = false;
    fetchCapabilities(clientSlug).then((caps) => {
      if (!cancelled) setLoaded({ slug: clientSlug, caps });
    });
    return () => {
      cancelled = true;
    };
  }, [clientSlug]);

  return clientSlug && loaded?.slug === clientSlug ? loaded.caps : null;
}
