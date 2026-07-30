-- 0014: Static-Ad Prompt Builder job queue.
--
-- Agent 1/2 prompts are the FIXED per-brand prompts that drive every static ad.
-- Until now they could only be authored by hand (2K–15K chars each) and seeded
-- from a CLI script, which is why a newly added brand — The Cap Company — had
-- none and could not use the Static Ad System at all.
--
-- This table is the review queue for auto-drafted prompts: a job researches the
-- brand, drafts both prompts, live-tests them against the runtime contract, and
-- parks at `awaiting_review`. A human approves, and ONLY then are the live
-- prompts in client_static_ad_config written. A failed or unreviewed job never
-- touches them.
--
-- Additive only (idempotent). Apply by hand via scripts/apply-0014.ts — the
-- drizzle journal is stale at 0002; NEVER run drizzle-kit generate/migrate here.
--
-- NOTE vs the donor portal: no brief_agent1_prompt / brief_agent2_prompt columns.
-- This portal has no Brief tab, so that stage is omitted from the pipeline.

CREATE TABLE IF NOT EXISTS client_static_ad_prompt_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  -- pending | running | awaiting_review | published | rejected | error
  status text NOT NULL DEFAULT 'pending',
  -- research | vibe | study | author1 | author2 | critique | publish
  stage text,
  brand_type text,                                    -- products | services
  vertical text,                                      -- snapshot of the vertical used
  reference_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  brand_dna jsonb,                                    -- the full BrandDNA object
  agent1_prompt text,                                 -- draft, not live
  agent2_prompt text,                                 -- draft, not live
  critic_report jsonb,
  error_message text,
  triggered_by text,                                  -- portal user id
  started_at timestamptz,
  completed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The UI lists a client's jobs newest-first.
CREATE INDEX IF NOT EXISTS idx_csap_jobs_client ON client_static_ad_prompt_jobs(client_id, created_at DESC);
-- The cron sweep claims by status.
CREATE INDEX IF NOT EXISTS idx_csap_jobs_status ON client_static_ad_prompt_jobs(status, created_at);

-- Retry accounting. The build runs inline in the generate route's after() phase,
-- so an invocation that dies mid-pipeline (deploy, timeout, cold-start eviction)
-- leaves a job wedged at `running`. The sweep retries such a job ONCE and then
-- gives up — each attempt costs ~8+N Opus calls, so unbounded retries are not an
-- option.
ALTER TABLE client_static_ad_prompt_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
