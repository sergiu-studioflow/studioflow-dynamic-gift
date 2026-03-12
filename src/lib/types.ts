// Core types — matches the base schema (Better Auth + users + appConfig + brandIntelligence + activityLog)
// Client-specific types are added when new systems are migrated into the portal

export type User = {
  id: string;
  userId: string; // references Better Auth user.id (text)
  displayName: string;
  email: string;
  role: string; // admin, member, viewer
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AppConfig = {
  id: string;
  brandName: string;
  brandColor: string | null;
  logoUrl: string | null;
  portalTitle: string | null;
  features: Record<string, boolean>;
  workflows: Record<string, { webhook_path: string; n8n_base_url?: string }>;
};

// Content Ideation System
export type IdeationRequest = {
  id: string;
  brand: string;
  direction: string;
  contentTypes: string[];
  numberOfIdeas: number;
  additionalContext: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ContentIdea = {
  id: string;
  requestId: string;
  hook: string;
  contentType: string;
  suggestedAngle: string;
  visualDirection: string;
  platformRecommendation: string;
  coreValueProps: string | null;
  copyDirection: string | null;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type IdeationRequestWithIdeas = IdeationRequest & {
  ideas: ContentIdea[];
};

export type BrandIntelligence = {
  id: string;
  title: string;
  rawContent: string | null;
  sections: Record<string, unknown> | null;
  airtableRecordId: string | null;
  updatedAt: Date;
  createdAt: Date;
};
