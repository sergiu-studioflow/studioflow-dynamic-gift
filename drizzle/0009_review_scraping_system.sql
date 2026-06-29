-- Review Scraping System
-- The `reviews` table already exists (created by the original n8n build) and is
-- populated. This migration extends `brands`, adds `archived_image_urls` to
-- `reviews` (R2 copies of customer photos), and creates the output tables for
-- generated testimonial graphics + the scrape-run tracker. Idempotent.

-- 1) Extend brands with the Google review source + per-brand toggle
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brands' AND column_name = 'google_maps_url') THEN
    ALTER TABLE "brands" ADD COLUMN "google_maps_url" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brands' AND column_name = 'google_place_id') THEN
    ALTER TABLE "brands" ADD COLUMN "google_place_id" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'brands' AND column_name = 'reviews_enabled') THEN
    ALTER TABLE "brands" ADD COLUMN "reviews_enabled" boolean NOT NULL DEFAULT false;
  END IF;
  -- R2 copies of customer review photos (download from Google CDN once)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'archived_image_urls') THEN
    ALTER TABLE "reviews" ADD COLUMN "archived_image_urls" jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- 2) review_graphics — one generated creative set per review (captions + approval).
-- review_id is TEXT, referencing the existing reviews.review_id (Google review id).
CREATE TABLE IF NOT EXISTS "review_graphics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" text REFERENCES "reviews"("review_id") ON DELETE CASCADE,
  "client_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewer_name" text,
  "review_text" text,
  "stars" integer,
  "pull_quote" text,
  "instagram_caption" text,
  "stories_caption" text,
  "facebook_caption" text,
  "cta" text,
  "hashtags" jsonb,
  "status" text NOT NULL DEFAULT 'generating',
  "error_message" text,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_review_graphics_client_id" ON "review_graphics" ("client_id");
CREATE INDEX IF NOT EXISTS "idx_review_graphics_status" ON "review_graphics" ("status");

-- 3) review_graphic_assets — one image per platform format
CREATE TABLE IF NOT EXISTS "review_graphic_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "graphic_id" uuid NOT NULL REFERENCES "review_graphics"("id") ON DELETE CASCADE,
  "format" text NOT NULL,
  "aspect_ratio" text NOT NULL,
  "kie_job_id" text,
  "image_url" text,
  "status" text NOT NULL DEFAULT 'generating',
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_review_graphic_assets_graphic_id" ON "review_graphic_assets" ("graphic_id");
CREATE INDEX IF NOT EXISTS "idx_review_graphic_assets_generating" ON "review_graphic_assets" ("status");

-- 4) review_scrape_runs — tracks each Apify scrape run for the ingest sweep
CREATE TABLE IF NOT EXISTS "review_scrape_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid REFERENCES "brands"("id") ON DELETE CASCADE,
  "apify_run_id" text,
  "apify_dataset_id" text,
  "status" text NOT NULL DEFAULT 'scraping',
  "reviews_found" integer NOT NULL DEFAULT 0,
  "reviews_new" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_review_scrape_runs_status" ON "review_scrape_runs" ("status");
