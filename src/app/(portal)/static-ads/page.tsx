"use client";

import { useState, useEffect } from "react";
import {
  ImageIcon,
  Sparkles,
  LayoutGrid,
  Pencil,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdGallery } from "@/components/static-ads/ad-gallery";
import { UnifiedGenerator } from "@/components/static-ads/unified-generator";
import { EditMode } from "@/components/static-ads/edit-mode";
import { WinnersLibraryManager } from "@/components/settings/winners-library-manager";

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
};

const TABS = [
  { key: "create", label: "Create", icon: Sparkles },
  { key: "edit", label: "Edit", icon: Pencil },
  { key: "gallery", label: "Gallery", icon: LayoutGrid },
  { key: "winners", label: "Winners", icon: Trophy },
];

export default function StaticAdsPage() {
  const [activeTab, setActiveTab] = useState("create");
  const [products, setProducts] = useState<Product[]>([]);
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);

  // Load products
  useEffect(() => {
    fetch("/api/products?full=true")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setProducts(data); })
      .catch(console.error);
  }, []);

  return (
    <div className="flex flex-col h-full -m-10 -mt-12">
      {/* Header bar */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border bg-background shrink-0">
        <ImageIcon className="h-4 w-4 text-primary mr-2" />
        <span className="text-sm font-semibold text-foreground mr-4">Static Ad System</span>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              activeTab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "create" && (
          <UnifiedGenerator
            products={products}
            onGalleryRefresh={() => setGalleryRefresh((n) => n + 1)}
            onEditAd={(id) => { setEditTargetId(id); setActiveTab("edit"); }}
          />
        )}

        {activeTab === "edit" && (
          <EditMode
            onGalleryRefresh={() => setGalleryRefresh((n) => n + 1)}
            initialGenerationId={editTargetId}
            onInitialHandled={() => setEditTargetId(null)}
          />
        )}

        {activeTab === "gallery" && (
          <div className="p-6">
            <AdGallery refreshTrigger={galleryRefresh} />
          </div>
        )}

        {activeTab === "winners" && (
          <div className="p-6">
            <WinnersLibraryManager />
          </div>
        )}
      </div>
    </div>
  );
}
