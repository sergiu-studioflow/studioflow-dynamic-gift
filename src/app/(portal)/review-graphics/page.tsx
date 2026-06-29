"use client";

import { useState } from "react";
import { Quote, Sparkles, LayoutGrid, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReviewList } from "@/components/review-graphics/review-list";
import { ReviewGenerator } from "@/components/review-graphics/review-generator";
import { ReviewGallery } from "@/components/review-graphics/review-gallery";

const TABS = [
  { key: "reviews", label: "Reviews", icon: MessageSquare },
  { key: "generate", label: "Generate", icon: Sparkles },
  { key: "gallery", label: "Gallery", icon: LayoutGrid },
];

export default function ReviewGraphicsPage() {
  const [activeTab, setActiveTab] = useState("reviews");
  const [galleryRefresh, setGalleryRefresh] = useState(0);

  return (
    <div className="flex flex-col h-full -m-10 -mt-12">
      {/* Header bar */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border bg-background shrink-0">
        <Quote className="h-4 w-4 text-primary mr-2" />
        <span className="text-sm font-semibold text-foreground mr-4">Review Graphics</span>
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
        {activeTab === "reviews" && (
          <div className="p-6">
            <ReviewList
              onGenerated={() => {
                setGalleryRefresh((n) => n + 1);
                setActiveTab("gallery");
              }}
            />
          </div>
        )}

        {activeTab === "generate" && (
          <ReviewGenerator
            onGenerated={() => {
              setGalleryRefresh((n) => n + 1);
              setActiveTab("gallery");
            }}
          />
        )}
        {activeTab === "gallery" && (
          <div className="p-6">
            <ReviewGallery refreshTrigger={galleryRefresh} />
          </div>
        )}
      </div>
    </div>
  );
}
