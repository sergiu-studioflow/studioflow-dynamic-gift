-- Brands table: client-managed brand list for Content Ideation dropdown
CREATE TABLE IF NOT EXISTS "brands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed existing brands
INSERT INTO "brands" ("name", "sort_order") VALUES
  ('Dynamic Gift', 0),
  ('Indigenous Promotions', 1),
  ('Event Display', 2),
  ('Lanyards Factory', 3),
  ('Pin Factory', 4),
  ('Inflatable Promotions', 5),
  ('Promo Superstore', 6),
  ('The Medal Factory', 7);
