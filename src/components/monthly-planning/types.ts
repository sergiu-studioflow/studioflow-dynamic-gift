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
  generationId: string | null;
  generationStatus: string | null;
  /** The generated ad's Quality Control status (pending | flagged | approved | rejected | skipped). */
  qcStatus: string | null;
  scheduledPostId: string | null;
  /** The linked post in the Post Scheduler, once queued. */
  post: { status: string; scheduledAt: string | null; timezone: string } | null;
  errorMessage: string | null;
  sortOrder: number;
  updatedAt: string;
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
  updatedAt: string;
  items?: PlanItem[];
};
