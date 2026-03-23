"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AdCopyForm } from "./ad-copy-form";
import { AdCopyLibrary } from "./ad-copy-library";
import { Sparkles, Library } from "lucide-react";

export function AdCopyTabs() {
  const [activeTab, setActiveTab] = useState("generate");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="generate" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Generate Ad Copy
        </TabsTrigger>
        <TabsTrigger value="library" className="gap-2">
          <Library className="h-4 w-4" />
          Copy Library
        </TabsTrigger>
      </TabsList>

      <TabsContent value="generate">
        <AdCopyForm
          onSuccess={() => {
            setRefreshKey((k) => k + 1);
            setActiveTab("library");
          }}
        />
      </TabsContent>

      <TabsContent value="library">
        <AdCopyLibrary key={refreshKey} />
      </TabsContent>
    </Tabs>
  );
}
