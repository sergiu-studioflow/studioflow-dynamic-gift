-- 0012: Quality Control Filter — ported from Pure Path 0016 (itself a port of OLS 0012 /
-- HelloHair 0011), extended for Dynamic Gift with a TEXT lane and a past-winners criterion.
--
-- Every NEW generated piece (static ad, video, ad-copy concept, video brief, content idea)
-- is auto-graded against the client's own ruleset (per-client compliance_config), with a
-- HARD gate at ship time: flagged pieces stay visible in their gallery/list but are blocked
-- from download / Winners / the posting queue / monthly-planning auto-publish until a human
-- approves them in the Quality Control review queue.
--
-- source_system ∈ static | video | ad_copy | video_brief | ideation.
-- NOTE: this portal's client table is `brands` (not `clients`).
--
-- Additive only (idempotent). Apply by hand via scripts/apply-0012.ts — the drizzle journal
-- is stale at 0002; NEVER run drizzle-kit generate/migrate on this portal.

-- Per-client QC ruleset (ONE row per client; UNIQUE makes the config route an upsert).
CREATE TABLE IF NOT EXISTS compliance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES brands(id) ON DELETE CASCADE,
  banned_phrasings jsonb NOT NULL DEFAULT '[]'::jsonb,  -- string[] deterministic red-line substrings (wrong domains/misspellings — hard-fail)
  visual_rules jsonb NOT NULL DEFAULT '[]'::jsonb,      -- string[] brand rules fed verbatim to the judge
  palette_hexes jsonb NOT NULL DEFAULT '[]'::jsonb,     -- string[] ad-design-layer palette (e.g. ["#0F172A","#FFFFFF"])
  product_facts jsonb NOT NULL DEFAULT '[]'::jsonb,     -- string[] what the real products are like (materials, print, finish)
  brand_safety_notes text,                              -- two-layer firewall + house style + advisory-only rules
  -- Past-winners criterion (Dynamic Gift addition): a written profile of what this client's
  -- winning creatives have in common, generated from winners_library. ADVISORY — never gates.
  winner_profile text,
  winner_profile_updated_at timestamptz,
  winner_profile_source_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Re-runnable on a table created by an earlier revision of this file.
ALTER TABLE compliance_config
  ADD COLUMN IF NOT EXISTS winner_profile text,
  ADD COLUMN IF NOT EXISTS winner_profile_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS winner_profile_source_count integer NOT NULL DEFAULT 0;

-- One AI grading job per generated output row.
CREATE TABLE IF NOT EXISTS gate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES brands(id) ON DELETE CASCADE,    -- nullable: ad-hoc reviews
  source_system text NOT NULL DEFAULT 'static',              -- static | video | ad_copy | video_brief | ideation
  source_id uuid,                                            -- the source row id (null for ad-hoc)
  asset_path text,                                           -- R2 public URL (image / video); NULL for the text lane
  copy_text text,                                            -- ad copy / script / concept body
  status text NOT NULL DEFAULT 'pending',                    -- pending | running | complete | failed
  overall_pass boolean,
  criteria_json jsonb NOT NULL DEFAULT '[]'::jsonb,          -- [{key,label,score,pass,note,assessed,gating}]
  reviewer text NOT NULL DEFAULT 'ai',                       -- ai | human
  overridden boolean NOT NULL DEFAULT false,
  grounding_source text,                                     -- flat | none
  ruleset_version integer,
  notes text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  error_message text,
  cost_cents integer NOT NULL DEFAULT 0,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS gate_reviews_status_idx ON gate_reviews(status);
CREATE INDEX IF NOT EXISTS gate_reviews_source_idx ON gate_reviews(source_id);
CREATE INDEX IF NOT EXISTS gate_reviews_client_idx ON gate_reviews(client_id);
-- Idempotency anchor for auto-enqueue (one review per source row; NULL source_id rows are
-- ad-hoc and Postgres treats NULLs as distinct → no false conflicts).
CREATE UNIQUE INDEX IF NOT EXISTS gate_reviews_source_uq ON gate_reviews(source_system, source_id);
-- The claim query filters status + attempts and orders by created_at.
CREATE INDEX IF NOT EXISTS gate_reviews_claim_idx ON gate_reviews(status, created_at);

-- qc_status columns on all FIVE gradable output tables. ('approved','skipped') = shippable.
ALTER TABLE static_ad_generations
  ADD COLUMN IF NOT EXISTS qc_status text NOT NULL DEFAULT 'pending', -- pending|flagged|approved|rejected|skipped
  ADD COLUMN IF NOT EXISTS qc_review_id uuid REFERENCES gate_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS qc_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE video_generations
  ADD COLUMN IF NOT EXISTS qc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qc_review_id uuid REFERENCES gate_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS qc_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE generated_ad_copy
  ADD COLUMN IF NOT EXISTS qc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qc_review_id uuid REFERENCES gate_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS qc_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE generated_video_briefs
  ADD COLUMN IF NOT EXISTS qc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qc_review_id uuid REFERENCES gate_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS qc_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE content_ideas
  ADD COLUMN IF NOT EXISTS qc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qc_review_id uuid REFERENCES gate_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS qc_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- The hard gate reads qc_status on every gallery/list query.
CREATE INDEX IF NOT EXISTS static_ad_generations_qc_idx ON static_ad_generations(qc_status);
CREATE INDEX IF NOT EXISTS video_generations_qc_idx ON video_generations(qc_status);
CREATE INDEX IF NOT EXISTS generated_ad_copy_qc_idx ON generated_ad_copy(qc_status);
CREATE INDEX IF NOT EXISTS generated_video_briefs_qc_idx ON generated_video_briefs(qc_status);
CREATE INDEX IF NOT EXISTS content_ideas_qc_idx ON content_ideas(qc_status);

-- CRITICAL backfill: grandfather everything that already exists so the hard gate does NOT
-- retroactively blank the live galleries and lists across all 9 clients at once. 'skipped'
-- = never gated (visible/shippable, deliberately distinct from AI-'approved' so the audit
-- trail stays honest). Only NEW output gets graded.
UPDATE static_ad_generations SET qc_status = 'skipped' WHERE status = 'completed' AND qc_status = 'pending';
UPDATE video_generations     SET qc_status = 'skipped' WHERE status = 'completed' AND qc_status = 'pending';
-- Refined-chain artifacts never ship as ads and are hidden from the gallery already.
UPDATE static_ad_generations SET qc_status = 'skipped'
  WHERE mode IN ('intermediate','logo-refined') AND qc_status = 'pending';
-- All pre-existing text output is grandfathered wholesale (these rows are terminal on insert).
UPDATE generated_ad_copy      SET qc_status = 'skipped' WHERE qc_status = 'pending';
UPDATE generated_video_briefs SET qc_status = 'skipped' WHERE qc_status = 'pending';
UPDATE content_ideas          SET qc_status = 'skipped' WHERE qc_status = 'pending';
