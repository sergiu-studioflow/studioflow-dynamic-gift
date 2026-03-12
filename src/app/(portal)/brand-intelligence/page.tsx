import { BrandDocSection } from "@/components/brand-intel/brand-doc-section";

export const dynamic = "force-dynamic";

export default function BrandIntelligencePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Brand Intelligence
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          View and manage the brand knowledge base and intelligence documents.
        </p>
      </div>

      <BrandDocSection />
    </div>
  );
}
