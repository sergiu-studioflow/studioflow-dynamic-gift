CREATE TABLE "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "target_audience" text,
  "solution" text,
  "pain_point" text,
  "brand_dna" text,
  "image_url" text,
  "video_image_url" text,
  "visual_description" text,
  "airtable_record_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
