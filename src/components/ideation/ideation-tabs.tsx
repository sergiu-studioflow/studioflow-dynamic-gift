"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { IdeationForm } from "./ideation-form";
import { IdeaLibrary } from "./idea-library";
import { Sparkles, Library } from "lucide-react";

export function IdeationTabs() {
  const [activeTab, setActiveTab] = useState("generate");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="generate" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Generate Ideas
        </TabsTrigger>
        <TabsTrigger value="library" className="gap-2">
          <Library className="h-4 w-4" />
          Idea Library
        </TabsTrigger>
      </TabsList>

      <TabsContent value="generate">
        <IdeationForm
          onSuccess={() => {
            setRefreshKey((k) => k + 1);
            setActiveTab("library");
          }}
        />
      </TabsContent>

      <TabsContent value="library">
        <IdeaLibrary key={refreshKey} />
      </TabsContent>
    </Tabs>
  );
}
