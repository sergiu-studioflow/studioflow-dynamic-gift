export type PostTarget = {
  id: string;
  postId: string;
  platform: "facebook" | "instagram";
  placement: "feed" | "story" | "reel";
  caption: string | null;
  hashtags: string[];
  enabled: boolean;
  status: "pending" | "publishing" | "published" | "failed" | "skipped";
  attemptCount: number;
  externalPermalink: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  socialAccountId: string | null;
};

export type ScheduledPost = {
  id: string;
  clientId: string;
  sourceType: "static_ad" | "winner" | "video" | "review_graphic" | "manual";
  mediaType: "image" | "video";
  mediaUrl: string;
  mediaPreviewUrl: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  status: "generating" | "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";
  scheduledAt: string | null;
  timezone: string;
  angleTag: string | null;
  errorMessage: string | null;
  sourceSnapshot: Record<string, unknown>;
  createdAt: string;
  targets: PostTarget[];
};

export type SocialAccount = {
  id: string;
  clientId: string;
  platform: "facebook" | "instagram";
  externalId: string;
  externalName: string | null;
  enabled: boolean;
  health: "unverified" | "ok" | "token_invalid" | "error";
  healthError: string | null;
  healthCheckedAt: string | null;
};

export type PostingPrefs = {
  timezone: string;
  slotTimes: string[];
  daysOfWeek: number[];
  maxPerDay: number;
};
