export type PlanStatus =
  | "planning" | "plan_ready" | "briefing" | "briefs_ready" | "producing" | "scheduled" | "complete" | "error";

export type ItemStatus =
  | "planned" | "briefing" | "brief_ready" | "producing" | "generated" | "scheduled" | "error" | "skipped";

export type PlanBrief = {
  id: string;
  briefType: "static" | "video";
  payload: Record<string, unknown>;
  status: string;
  edited: boolean;
};

export type PlanItem = {
  id: string;
  planId: string;
  clientId: string;
  brandName: string;
  plannedDate: string;
  assetType: "static" | "video";
  format: "feed" | "story" | "reel";
  platforms: string[];
  angleTag: string | null;
  topic: string | null;
  productId: string | null;
  title: string | null;
  direction: string | null;
  status: ItemStatus;
  brief: PlanBrief | null;
  previewUrl: string | null;
  generationStatus: string | null;
  errorMessage: string | null;
  sortOrder: number;
};

export type MonthlyPlan = {
  id: string;
  month: string;
  title: string | null;
  status: PlanStatus;
  inputConfig: Record<string, unknown>;
  errorMessage: string | null;
  itemCount?: number;
  createdAt: string;
  items?: PlanItem[];
};
