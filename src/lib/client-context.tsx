"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Client } from "@/lib/types";

type ClientContextType = {
  /** Currently selected client ID, or null for "All Clients" */
  clientId: string | null;
  /** Currently selected client name */
  clientName: string;
  /** Currently selected client slug */
  clientSlug: string;
  /** R2 storage prefix for current client */
  storagePrefix: string;
  /** All available clients */
  clients: Client[];
  /** True when no specific client is selected */
  isAllClients: boolean;
  /** True when multi-client mode is active */
  isMultiClient: boolean;
  /** Select a client by ID, or null for "All Clients" */
  setClient: (id: string | null) => void;
  /** Pre-built query param string for API calls: "clientId=uuid" or "" */
  clientQueryParam: string;
  /** True while clients are being fetched */
  isLoading: boolean;
  /** True when context is fully initialized and safe to use for data fetching */
  isReady: boolean;
  /** Refetch the client list */
  refetchClients: () => Promise<void>;
};

const ClientContext = createContext<ClientContextType | null>(null);

const STORAGE_KEY = "studioflow-selected-client-id";

export function useClient(): ClientContextType {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    // Return a safe no-op context for non-multi-client portals
    return {
      clientId: null,
      clientName: "",
      clientSlug: "",
      storagePrefix: "",
      clients: [],
      isAllClients: true,
      isMultiClient: false,
      setClient: () => {},
      clientQueryParam: "",
      isLoading: false,
      isReady: true,
      refetchClients: async () => {},
    };
  }
  return ctx;
}

export function ClientProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Fetch clients from API
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        // Normalize: some portals use brandName (brands table alias), others use clientName
        const normalized: Client[] = (Array.isArray(data) ? data : []).map((c: any) => ({
          ...c,
          clientName: c.clientName || c.brandName || c.name || "",
          clientSlug: c.clientSlug || c.slug || "",
        }));
        setClients(normalized.filter((c) => c.status === "Active"));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // Initialize selected client from URL param → localStorage → first client
  useEffect(() => {
    if (isLoading || clients.length === 0) return;

    const urlSlug = searchParams.get("client");
    let resolved: Client | undefined;

    // 1. Try URL param
    if (urlSlug) {
      resolved = clients.find((c) => c.clientSlug === urlSlug);
    }

    // 2. Try localStorage
    if (!resolved) {
      const storedId = localStorage.getItem(STORAGE_KEY);
      if (storedId) {
        resolved = clients.find((c) => c.id === storedId);
      }
    }

    // 3. Default to first client
    if (!resolved) {
      resolved = clients[0];
    }

    if (resolved) {
      setClientId(resolved.id);
      localStorage.setItem(STORAGE_KEY, resolved.id);
    }
    setIsReady(true);
  }, [isLoading, clients, searchParams]);

  // Set client and update localStorage + URL
  const setClient = useCallback(
    (id: string | null) => {
      setClientId(id);

      if (id) {
        localStorage.setItem(STORAGE_KEY, id);
        const client = clients.find((c) => c.id === id);
        if (client) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("client", client.clientSlug || client.id);
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }
      } else {
        localStorage.removeItem(STORAGE_KEY);
        const params = new URLSearchParams(searchParams.toString());
        params.delete("client");
        const qs = params.toString();
        router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      }
    },
    [clients, router, pathname, searchParams]
  );

  const selectedClient = clientId
    ? clients.find((c) => c.id === clientId) || null
    : null;

  const isAllClients = !clientId;

  const clientQueryParam = clientId
    ? `clientId=${encodeURIComponent(clientId)}`
    : "";

  return (
    <ClientContext.Provider
      value={{
        clientId,
        clientName: selectedClient?.clientName || "All Clients",
        clientSlug: selectedClient?.clientSlug || "",
        storagePrefix: selectedClient?.storagePrefix || "",
        clients,
        isAllClients,
        isMultiClient: true,
        setClient,
        clientQueryParam,
        isLoading,
        isReady,
        refetchClients: fetchClients,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
}
