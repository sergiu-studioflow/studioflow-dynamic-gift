import { AdCopyTabs } from "@/components/ad-copy/ad-copy-tabs";

export const dynamic = "force-dynamic";

export default function AdCopyPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Ad Copy Generator
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Generate complete Meta ad copy sets with multiple variations per concept for A/B testing.
        </p>
      </div>
      <AdCopyTabs />
    </div>
  );
}
