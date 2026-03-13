import { BrandDocSection } from "@/components/brand-intel/brand-doc-section";
import { BrandsManager } from "@/components/brand-intel/brands-manager";

export const dynamic = "force-dynamic";

export default function BrandIntelligencePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Brand Intelligence
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          View and manage Dynamic Gift&apos;s brand knowledge base and intelligence documents.
        </p>
      </div>

      <BrandsManager />
      <BrandDocSection />
    </div>
  );
}
