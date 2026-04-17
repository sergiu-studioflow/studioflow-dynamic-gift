import type { LucideIcon } from "lucide-react";

export function PlatformPlaceholder({
  platform,
  icon: Icon,
  description,
}: {
  platform: string;
  icon: LucideIcon;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <span className="mb-3 inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
        Coming Soon
      </span>
      <h3 className="text-lg font-semibold text-foreground">{platform} Research</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
