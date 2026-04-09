import { pgTable, text, boolean, timestamp, uuid, jsonb, integer } from "drizzle-orm/pg-core";

// =============================================
// BETTER AUTH TABLES (managed by better-auth — do not modify manually)
// =============================================

export const authUser = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const authSession = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
});

export const authAccount = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const authVerification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// =============================================
// USERS (portal profile — linked to Better Auth user)
// =============================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique().references(() => authUser.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"), // admin, member, viewer
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// APP CONFIGURATION (single row)
// =============================================

export const appConfig = pgTable("app_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandName: text("brand_name").notNull(),
  brandColor: text("brand_color").default("#b2ff00"),
  logoUrl: text("logo_url"),
  portalTitle: text("portal_title"),
  features: jsonb("features").notNull().default({}),
  workflows: jsonb("workflows").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// BRAND INTELLIGENCE (single row)
// =============================================

export const brandIntelligence = pgTable("brand_intelligence", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("Brand Intelligence"),
  rawContent: text("raw_content"),
  sections: jsonb("sections"),
  airtableRecordId: text("airtable_record_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// BRANDS (client-managed brand list)
// =============================================

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// CONTENT IDEATION SYSTEM
// =============================================

export const ideationRequests = pgTable("ideation_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  brand: text("brand").notNull(),
  direction: text("direction").notNull(),
  contentTypes: jsonb("content_types").notNull(),
  numberOfIdeas: integer("number_of_ideas").notNull().default(25),
  additionalContext: text("additional_context"),
  status: text("status").notNull().default("new"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contentIdeas = pgTable("content_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => ideationRequests.id, { onDelete: "cascade" }),
  hook: text("hook").notNull(),
  contentType: text("content_type").notNull(),
  suggestedAngle: text("suggested_angle").notNull(),
  visualDirection: text("visual_direction").notNull(),
  platformRecommendation: text("platform_recommendation").notNull(),
  coreValueProps: text("core_value_props"),
  copyDirection: text("copy_direction"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// VIDEO BRIEF + SCRIPT SYSTEM
// =============================================

export const videoBriefRequests = pgTable("video_brief_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  brand: text("brand").notNull(),
  requestLabel: text("request_label"),
  contentType: text("content_type"),
  platform: text("platform"),
  targetPersona: text("target_persona"),
  funnelStage: text("funnel_stage"),
  duration: text("duration"),
  hookStyle: text("hook_style"),
  scenarioDirection: text("scenario_direction"),
  productFocus: text("product_focus"),
  valuePropFocus: text("value_prop_focus"),
  numberOfHooks: integer("number_of_hooks").default(5),
  additionalContext: text("additional_context"),
  status: text("status").notNull().default("submitted"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generatedVideoBriefs = pgTable("generated_video_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").references(() => videoBriefRequests.id),
  briefTitle: text("brief_title"),
  strategicHypothesis: text("strategic_hypothesis"),
  psychologyAngle: text("psychology_angle"),
  targetPersona: text("target_persona"),
  funnelStage: text("funnel_stage"),
  contentType: text("content_type"),
  platform: text("platform"),
  duration: text("duration"),
  primaryHook: text("primary_hook"),
  hookVariations: jsonb("hook_variations"),
  fullScript: text("full_script"),
  sceneBreakdown: text("scene_breakdown"),
  shotList: text("shot_list"),
  visualDirection: text("visual_direction"),
  audioDirection: text("audio_direction"),
  musicDirection: text("music_direction"),
  onScreenText: text("on_screen_text"),
  talentNotes: text("talent_notes"),
  locationRequirements: text("location_requirements"),
  bRollGuidance: text("b_roll_guidance"),
  brandVoiceLock: text("brand_voice_lock"),
  valuePropFocus: text("value_prop_focus"),
  complianceNotes: text("compliance_notes"),
  aiGenerationNotes: text("ai_generation_notes"),
  status: text("status").notNull().default("pending_review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// AD COPY GENERATION SYSTEM
// =============================================

export const adCopyRequests = pgTable("ad_copy_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  brand: text("brand").notNull(),
  campaignObjective: text("campaign_objective").notNull(),
  targetPersona: text("target_persona").notNull(),
  productFocus: text("product_focus"),
  angleEmphasis: jsonb("angle_emphasis").notNull().default([]),
  adFormat: text("ad_format").notNull(),
  toneVariation: text("tone_variation"),
  numberOfConcepts: integer("number_of_concepts").notNull().default(3),
  additionalContext: text("additional_context"),
  status: text("status").notNull().default("new"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generatedAdCopy = pgTable("generated_ad_copy", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => adCopyRequests.id, { onDelete: "cascade" }),
  conceptNumber: integer("concept_number").notNull(),
  conceptName: text("concept_name"),
  conceptStrategy: text("concept_strategy"),
  anglesUsed: jsonb("angles_used"),
  primaryTextShort: text("primary_text_short"),
  primaryTextMedium: text("primary_text_medium"),
  primaryTextLong: text("primary_text_long"),
  headlines: jsonb("headlines"),
  descriptions: jsonb("descriptions"),
  hookLines: jsonb("hook_lines"),
  ctaRecommendation: text("cta_recommendation"),
  abTestingNotes: text("ab_testing_notes"),
  complianceStatus: text("compliance_status").notNull().default("passed"),
  complianceNotes: text("compliance_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// PRODUCTS (product catalogue for AI generation systems)
// =============================================

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  targetAudience: text("target_audience"),
  solution: text("solution"),
  painPoint: text("pain_point"),
  brandDna: text("brand_dna"),
  imageUrl: text("image_url"),
  videoImageUrl: text("video_image_url"),
  visualDescription: text("visual_description"),
  airtableRecordId: text("airtable_record_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// AD STYLES (template-based ad generation)
// =============================================

export const adStyles = pgTable("ad_styles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  masterPrompt: text("master_prompt").notNull(),
  referenceImageUrl: text("reference_image_url"),
  thumbnailUrl: text("thumbnail_url"),
  aspectRatio: text("aspect_ratio").notNull().default("1:1"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adStylePrompts = pgTable("ad_style_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  adStyleId: uuid("ad_style_id").notNull().references(() => adStyles.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// STATIC AD GENERATIONS
// =============================================

export const staticAdGenerations = pgTable("static_ad_generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  adStyleId: uuid("ad_style_id").references(() => adStyles.id),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  styleName: text("style_name"),
  productName: text("product_name"),
  finalPrompt: text("final_prompt"),
  kieJobId: text("kie_job_id"),
  aspectRatio: text("aspect_ratio").notNull().default("1:1"),
  resolution: text("resolution").default("1K"),
  outputFormat: text("output_format").default("PNG"),
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  mode: text("mode").notNull().default("default"),
  referenceImageUrl: text("reference_image_url"),
  adCopy: text("ad_copy"),
  analysisJson: text("analysis_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// REFERENCE AD LIBRARY (shared across portals)
// =============================================

export const referenceAdLibrary = pgTable("reference_ad_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  industry: text("industry").notNull().default("beauty"),
  adType: text("ad_type"),
  brand: text("brand"),
  tags: text("tags"),
  airtableRecordId: text("airtable_record_id").unique(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// WINNERS LIBRARY
// =============================================

export const winnersLibrary = pgTable("winners_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  sourceGenerationId: uuid("source_generation_id"),
  productName: text("product_name"),
  tags: text("tags"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================
// ACTIVITY LOG (generic — all portals)
// =============================================

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
