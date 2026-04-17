"use client";

import { useState, useEffect } from "react";
import { Video, Sparkles, LayoutGrid, Users, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { VideoGenerator } from "@/components/video-generation/video-generator";
import { VideoGallery } from "@/components/video-generation/video-gallery";
import { CharactersLibrary } from "@/components/video-generation/characters-library";
import { ScenesLibrary } from "@/components/video-generation/scenes-library";
import { useClient } from "@/lib/client-context";

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
  imagePreviewUrl: string | null;
  videoImageUrl: string | null;
  videoImagePreviewUrl: string | null;
};

const TABS = [
  { key: "create", label: "Create", icon: Sparkles },
  { key: "gallery", label: "Gallery", icon: LayoutGrid },
  { key: "characters", label: "Characters", icon: Users },
  { key: "scenes", label: "Scenes", icon: ImageIcon },
];

export default function VideoGenerationPage() {
  const { clientSlug, isReady } = useClient();
  const [activeTab, setActiveTab] = useState("create");
  const [products, setProducts] = useState<Product[]>([]);
  const [galleryRefresh, setGalleryRefresh] = useState(0);

  useEffect(() => {
    if (!isReady || !clientSlug) return;
    fetch(`/api/clients/${clientSlug}/products`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(
            data.map((p: any) => ({
              id: p.id,
              name: p.productName,
              imageUrl: p.imageUrl,
              imagePreviewUrl: p.imageUrl,
              videoImageUrl: p.videoImageUrl,
              videoImagePreviewUrl: p.videoImageUrl,
            }))
          );
        }
      })
      .catch(console.error);
  }, [clientSlug, isReady]);

  return (
    <div className="flex flex-col h-full -m-10 -mt-12">
      {/* Header bar */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border bg-background shrink-0">
        <Video className="h-4 w-4 text-primary mr-2" />
        <span className="text-sm font-semibold text-foreground mr-4">Video Generation</span>
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
          <VideoGenerator
            products={products}
            onGalleryRefresh={() => setGalleryRefresh((n) => n + 1)}
          />
        )}

        {activeTab === "gallery" && (
          <div className="p-6">
            <VideoGallery refreshTrigger={galleryRefresh} />
          </div>
        )}

        {activeTab === "characters" && (
          <div className="p-6">
            <CharactersLibrary />
          </div>
        )}

        {activeTab === "scenes" && (
          <div className="p-6">
            <ScenesLibrary />
          </div>
        )}
      </div>
    </div>
  );
}
