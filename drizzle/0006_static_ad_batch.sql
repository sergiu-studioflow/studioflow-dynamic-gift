-- Static Ad Multi-Variation Support
-- Adds batch grouping columns to static_ad_generations so one click can
-- produce 1–5 parallel Kie/Nano Banana variations sharing the same prompt.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'static_ad_generations' AND column_name = 'batch_id') THEN
    ALTER TABLE "static_ad_generations" ADD COLUMN "batch_id" uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'static_ad_generations' AND column_name = 'batch_size') THEN
    ALTER TABLE "static_ad_generations" ADD COLUMN "batch_size" integer NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'static_ad_generations' AND column_name = 'batch_index') THEN
    ALTER TABLE "static_ad_generations" ADD COLUMN "batch_index" integer NOT NULL DEFAULT 1;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_static_ad_generations_batch_id" ON "static_ad_generations" ("batch_id");
