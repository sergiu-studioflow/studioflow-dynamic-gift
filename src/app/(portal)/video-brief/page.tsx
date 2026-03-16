import { VideoBriefTabs } from "@/components/video-brief/video-brief-tabs";

export const dynamic = "force-dynamic";

export default function VideoBriefPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Video Brief + Script
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Generate production-ready video briefs with timed scripts, hook variations, and shot lists.
        </p>
      </div>
      <VideoBriefTabs />
    </div>
  );
}
