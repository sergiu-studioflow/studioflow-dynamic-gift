-- 0013: Multi-Brand Scaling — per-brand reference sets + posting timezone backfill.
--
-- Additive only (idempotent). Apply by hand via scripts/apply-0013.ts — the drizzle
-- journal is stale at 0002; NEVER run drizzle-kit generate/migrate on this portal.

-- ---------------------------------------------------------------------------
-- 1. Per-brand reference sets.
--
-- reference_ad_library was completely un-scoped: one global pool that every brand
-- drew from at random. Its `industry` column defaults to 'beauty' and the corpus
-- is a cross-portal set, so a beauty-ad layout could be stamped onto a
-- promotional-products ad — and identically across all 8 brands, which is exactly
-- what "content stays distinct" is supposed to prevent.
--
-- client_id NULL  = shared pool (every brand may fall back to it)
-- client_id SET   = that brand's own curated reference
-- ---------------------------------------------------------------------------
ALTER TABLE reference_ad_library
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES brands(id) ON DELETE CASCADE;

-- Selection filters on (client_id, is_active); industry is the shared-pool filter.
CREATE INDEX IF NOT EXISTS reference_ad_library_client_idx ON reference_ad_library(client_id, is_active);
CREATE INDEX IF NOT EXISTS reference_ad_library_industry_idx ON reference_ad_library(industry) WHERE client_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Posting timezone backfill.
--
-- scheduled_posts.timezone defaults to 'Australia/Sydney' and NOTHING ever wrote
-- it, so a brand configured for another zone had its posts computed correctly in
-- UTC but DISPLAYED in Sydney time in the queue. The writers are fixed in code;
-- this repoints existing rows at their brand's configured zone.
--
-- Brands with no posting prefs keep the default, which is what resolvePrefs()
-- would return for them anyway.
-- ---------------------------------------------------------------------------
UPDATE scheduled_posts sp
SET timezone = b.settings -> 'posting' ->> 'timezone'
FROM brands b
WHERE sp.client_id = b.id
  AND b.settings -> 'posting' ->> 'timezone' IS NOT NULL
  AND b.settings -> 'posting' ->> 'timezone' <> ''
  AND sp.timezone IS DISTINCT FROM b.settings -> 'posting' ->> 'timezone';

-- ---------------------------------------------------------------------------
-- 3. Normalise the shared library's industry vocabulary.
--
-- The corpus accumulated duplicate spellings of the same vertical
-- ('beauty' vs 'Beauty', 'Health + Wellness' vs 'Health and Wellness'), which
-- split the pool and made any industry filter miss most of its own category.
-- ---------------------------------------------------------------------------
UPDATE reference_ad_library SET industry = 'Beauty'             WHERE industry = 'beauty';
UPDATE reference_ad_library SET industry = 'Health and Wellness' WHERE industry = 'Health + Wellness';
UPDATE reference_ad_library SET industry = 'Food and Drink'      WHERE industry = 'Food + Drink';
UPDATE reference_ad_library SET industry = 'Homeware'            WHERE industry = 'Homewear';
