-- Static Ad — Product-Consistent Refinement
-- Adds source_generation_id so a "refined" row (mode='refined') can point
-- back at the variation it was generated from via GPT Image 2 image-to-image.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'static_ad_generations' AND column_name = 'source_generation_id') THEN
    ALTER TABLE "static_ad_generations" ADD COLUMN "source_generation_id" uuid;
    ALTER TABLE "static_ad_generations"
      ADD CONSTRAINT "static_ad_generations_source_generation_id_fkey"
      FOREIGN KEY ("source_generation_id")
      REFERENCES "static_ad_generations" ("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_static_ad_generations_source_generation_id"
  ON "static_ad_generations" ("source_generation_id");
