-- StudioFlow Portal Template — Core Schema v2.0.0
-- Auth: Better Auth (magic link via Resend)
-- DB: Neon PostgreSQL
--
-- Run with: npm run db:migrate
-- Or manually: psql $DATABASE_URL -f drizzle/0000_core_schema.sql

-- ─── Better Auth Tables (managed by better-auth) ──────────────────────────
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean NOT NULL,
  "image" text,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp,
  "refresh_token_expires_at" timestamp,
  "scope" text,
  "password" text,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp,
  "updated_at" timestamp
);

-- ─── Portal Users ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  "display_name" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "is_active" boolean NOT NULL DEFAULT true,
  "last_login_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ─── App Configuration (single row) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "app_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_name" text NOT NULL,
  "brand_color" text DEFAULT '#b2ff00',
  "logo_url" text,
  "portal_title" text,
  "features" jsonb NOT NULL DEFAULT '{}',
  "workflows" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ─── Brand Intelligence (single row) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "brand_intelligence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL DEFAULT 'Brand Intelligence',
  "raw_content" text,
  "sections" jsonb,
  "airtable_record_id" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- ─── Activity Log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" uuid,
  "details" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
