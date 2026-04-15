"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Building2, Plus } from "lucide-react";
import { useClient } from "@/lib/client-context";
import { cn } from "@/lib/utils";
import Link from "next/link";

const CLUSTER_COLORS: Record<string, string> = {
  "Instagram Growth": "text-pink-400",
  "TikTok Growth": "text-cyan-400",
  "AI Writing": "text-violet-400",
  "Cold Email": "text-orange-400",
  "Supplements": "text-emerald-400",
  "Skincare": "text-rose-400",
  "Fashion": "text-amber-400",
  "Food & Beverage": "text-yellow-400",
  "Health & Wellness": "text-teal-400",
  "E-commerce": "text-blue-400",
  "SaaS": "text-indigo-400",
  "Finance": "text-slate-400",
};

export function ClientSwitcher() {
  const { clients, clientId, clientName, isAllClients, setClient } = useClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Auto-focus search on open
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const selectedClient = clientId
    ? clients.find((c) => c.id === clientId)
    : null;

  const filtered = clients.filter(
    (c) =>
      c.clientName.toLowerCase().includes(search.toLowerCase()) ||
      (c.cluster || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.category || "").toLowerCase().includes(search.toLowerCase())
  );

  // Group by cluster (or "Other" if no cluster)
  const hasClusters = clients.some((c) => c.cluster);
  const grouped = hasClusters
    ? filtered.reduce<Record<string, typeof filtered>>((acc, c) => {
        const cluster = c.cluster || "Other";
        if (!acc[cluster]) acc[cluster] = [];
        acc[cluster].push(c);
        return acc;
      }, {})
    : { All: filtered };

  return (
    <div ref={ref} className="relative mx-3 my-3">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all duration-150",
          "border border-white/10 hover:border-white/20 hover:bg-white/5",
          open && "border-white/20 bg-white/5"
        )}
      >
        {/* Client avatar/icon */}
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 flex-shrink-0">
          {selectedClient?.logoUrl ? (
            <img
              src={selectedClient.logoUrl}
              alt=""
              className="h-5 w-5 rounded object-cover"
            />
          ) : (
            <Building2 className="h-3.5 w-3.5 text-white/60" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="truncate text-[13px] font-medium text-white/90">
            {isAllClients ? "All Clients" : clientName}
          </p>
          {selectedClient?.cluster && (
            <p
              className={cn(
                "text-[10px] font-medium",
                CLUSTER_COLORS[selectedClient.cluster] || "text-white/40"
              )}
            >
              {selectedClient.cluster}
            </p>
          )}
          {selectedClient?.category && !selectedClient?.cluster && (
            <p className="text-[10px] text-white/40">{selectedClient.category}</p>
          )}
          {isAllClients && (
            <p className="text-[10px] text-white/35">
              {clients.length} client{clients.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-white/40 transition-transform duration-150 flex-shrink-0",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-white/15 bg-[#1a1a1f] shadow-xl">
          {/* Search */}
          <div className="border-b border-white/10 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search clients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white/90 placeholder:text-white/30 outline-none focus:bg-white/8"
              />
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {/* All Clients option */}
            <button
              onClick={() => {
                setClient(null);
                setOpen(false);
                setSearch("");
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                isAllClients
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/5 hover:text-white/80"
              )}
            >
              <div className="flex h-5 w-5 items-center justify-center rounded bg-white/10">
                <Building2 className="h-3 w-3" />
              </div>
              <span className="text-xs font-medium">All Clients</span>
              <span className="ml-auto text-[10px] text-white/30">
                {clients.length}
              </span>
              {isAllClients && (
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--brand-primary,#b2ff00)]" />
              )}
            </button>

            <div className="mx-3 my-1 h-px bg-white/8" />

            {/* Client list (grouped or flat) */}
            {Object.entries(grouped).map(([cluster, clusterClients]) => (
              <div key={cluster}>
                {hasClusters && (
                  <p
                    className={cn(
                      "px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest",
                      CLUSTER_COLORS[cluster] || "text-white/25"
                    )}
                  >
                    {cluster}
                  </p>
                )}
                {clusterClients.map((c) => {
                  const isSelected = clientId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setClient(c.id);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                        isSelected
                          ? "bg-white/10 text-white"
                          : "text-white/55 hover:bg-white/5 hover:text-white/80"
                      )}
                    >
                      {c.logoUrl ? (
                        <img
                          src={c.logoUrl}
                          alt=""
                          className="h-4 w-4 rounded object-cover flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold flex-shrink-0"
                          style={{
                            backgroundColor: c.brandColor
                              ? `${c.brandColor}20`
                              : "rgba(255,255,255,0.1)",
                            color: c.brandColor || "rgba(255,255,255,0.5)",
                          }}
                        >
                          {c.clientName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs truncate">{c.clientName}</span>
                      {c.category && !hasClusters && (
                        <span className="ml-auto text-[10px] text-white/25 truncate max-w-[80px]">
                          {c.category}
                        </span>
                      )}
                      {isSelected && (
                        <div className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--brand-primary,#b2ff00)] flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-white/30">
                No clients match &quot;{search}&quot;
              </p>
            )}
          </div>

          {/* Add Client button */}
          <div className="border-t border-white/10 p-2">
            <Link
              href="/clients/new"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/80"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Client
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
