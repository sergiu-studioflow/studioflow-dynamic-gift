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

// Video Brief + Script System
export type VideoBriefRequest = {
  id: string;
  brand: string;
  requestLabel: string | null;
  contentType: string | null;
  platform: string | null;
  targetPersona: string | null;
  funnelStage: string | null;
  duration: string | null;
  hookStyle: string | null;
  scenarioDirection: string | null;
  productFocus: string | null;
  valuePropFocus: string | null;
  numberOfHooks: number | null;
  additionalContext: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GeneratedVideoBrief = {
  id: string;
  requestId: string | null;
  briefTitle: string | null;
  strategicHypothesis: string | null;
  psychologyAngle: string | null;
  targetPersona: string | null;
  funnelStage: string | null;
  contentType: string | null;
  platform: string | null;
  duration: string | null;
  primaryHook: string | null;
  hookVariations: HookVariation[] | null;
  fullScript: string | null;
  sceneBreakdown: string | null;
  shotList: string | null;
  visualDirection: string | null;
  audioDirection: string | null;
  musicDirection: string | null;
  onScreenText: string | null;
  talentNotes: string | null;
  locationRequirements: string | null;
  bRollGuidance: string | null;
  brandVoiceLock: string | null;
  valuePropFocus: string | null;
  complianceNotes: string | null;
  aiGenerationNotes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type HookVariation = {
  title: string;
  type: string;
  text: string;
  visual: string;
  why_it_works: string;
  platform_best_fit: string;
  estimated_stop_rate: string;
};

export type VideoBriefRequestWithBriefs = VideoBriefRequest & {
  briefs: GeneratedVideoBrief[];
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
