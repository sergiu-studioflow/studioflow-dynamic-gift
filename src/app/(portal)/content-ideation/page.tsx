import { IdeationTabs } from "@/components/ideation/ideation-tabs";

export const dynamic = "force-dynamic";

export default function ContentIdeationPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Content Ideation
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Generate 20-30 differentiated content ideas per batch across all Dynamic Gift brands.
        </p>
      </div>

      <IdeationTabs />
    </div>
  );
}
