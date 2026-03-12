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

export type BrandIntelligence = {
  id: string;
  title: string;
  rawContent: string | null;
  sections: Record<string, unknown> | null;
  airtableRecordId: string | null;
  updatedAt: Date;
  createdAt: Date;
};
