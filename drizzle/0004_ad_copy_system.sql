-- Ad Copy Generation System
-- Generates complete Meta ad copy sets (primary text, headlines, descriptions)
-- with multiple variations per concept for A/B testing

CREATE TABLE IF NOT EXISTS ad_copy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  campaign_objective TEXT NOT NULL,
  target_persona TEXT NOT NULL,
  product_focus TEXT,
  angle_emphasis JSONB NOT NULL DEFAULT '[]',
  ad_format TEXT NOT NULL,
  tone_variation TEXT,
  number_of_concepts INTEGER NOT NULL DEFAULT 3,
  additional_context TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_ad_copy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ad_copy_requests(id) ON DELETE CASCADE,
  concept_number INTEGER NOT NULL,
  concept_name TEXT,
  concept_strategy TEXT,
  angles_used JSONB,
  primary_text_short TEXT,
  primary_text_medium TEXT,
  primary_text_long TEXT,
  headlines JSONB,
  descriptions JSONB,
  hook_lines JSONB,
  cta_recommendation TEXT,
  ab_testing_notes TEXT,
  compliance_status TEXT NOT NULL DEFAULT 'passed',
  compliance_notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
