"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { VideoBriefForm } from "./video-brief-form";
import { VideoBriefLibrary } from "./video-brief-library";
import { Sparkles, Library } from "lucide-react";

export function VideoBriefTabs() {
  const [activeTab, setActiveTab] = useState("generate");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="generate" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Generate Brief
        </TabsTrigger>
        <TabsTrigger value="library" className="gap-2">
          <Library className="h-4 w-4" />
          Brief Library
        </TabsTrigger>
      </TabsList>

      <TabsContent value="generate">
        <VideoBriefForm
          onSuccess={() => {
            setRefreshKey((k) => k + 1);
            setActiveTab("library");
          }}
        />
      </TabsContent>

      <TabsContent value="library">
        <VideoBriefLibrary key={refreshKey} />
      </TabsContent>
    </Tabs>
  );
}
