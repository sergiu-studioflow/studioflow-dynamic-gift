"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
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
  /** Set when the client list could not be loaded (the context is still ready, with no clients). */
  clientsError: string | null;
  /** Refetch the client list */
  refetchClients: () => Promise<void>;
};

const ClientContext = createContext<ClientContextType | null>(null);

const STORAGE_KEY = "studioflow-selected-client-id";
// Stored (and ?client=) value for an explicit "All Clients" choice. Clearing the selection used
// to look exactly like never having chosen, so the default brand was re-applied immediately.
const ALL_CLIENTS = "all";

function readStoredChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode, disabled site data)
  }
}

function storeChoice(value: string) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage blocked — the in-session choice still applies */
  }
}

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
      clientsError: null,
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
  const [clientsError, setClientsError] = useState<string | null>(null);
  // The choice made in this tab, for when localStorage is unavailable.
  const sessionChoice = useRef<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Only the ?client= value matters. The searchParams object changes on every navigation,
  // which used to re-run initialisation (and re-pick the default brand) on each page change.
  const urlChoice = searchParams.get("client");

  // Fetch clients from API
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      const rows = (Array.isArray(data) ? data : []) as Client[];
      const normalized = rows.map((c) => ({ ...c, clientName: c.clientName || c.brandName || "" }));
      // The default brand is the first by sortOrder. The API already returns that order; the
      // (stable) sort only keeps a regression there from changing which brand opens by default.
      setClients(
        normalized.filter((c) => c.status === "Active").sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      );
      setClientsError(null);
    } catch {
      setClientsError("Couldn't load the brand list. Refresh the page to try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // Resolve the selection: URL (?client=<slug>|all) → stored choice (incl. "all") → first brand.
  // Runs when the client list arrives or the ?client= value changes — never merely because
  // the user navigated. If the list failed to load, it still becomes ready (with no brand) so
  // pages can render their empty/error state instead of spinning.
  useEffect(() => {
    if (isLoading) return;

    const find = (value: string) => clients.find((c) => c.clientSlug === value || c.id === value);
    const choose = (value: string | null): string | null | undefined => {
      if (!value) return undefined;
      if (value === ALL_CLIENTS) return null;
      return find(value)?.id;
    };

    let next = choose(urlChoice);
    if (next === undefined) next = choose(readStoredChoice() ?? sessionChoice.current);

    if (next === undefined) {
      next = clients[0]?.id ?? null;
    } else if (urlChoice) {
      // A shared link is a choice too: remember it for the pages it navigates to.
      storeChoice(next ?? ALL_CLIENTS);
    }

    setClientId(next);
    setIsReady(true);
  }, [isLoading, clients, urlChoice]);

  // Set client and update localStorage + URL
  const setClient = useCallback(
    (id: string | null) => {
      const choice = id ?? ALL_CLIENTS;
      sessionChoice.current = choice;
      storeChoice(choice);
      setClientId(id);

      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        const client = clients.find((c) => c.id === id);
        params.set("client", client?.clientSlug || id);
      } else {
        params.set("client", ALL_CLIENTS);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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
        clientsError,
        refetchClients: fetchClients,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
}
