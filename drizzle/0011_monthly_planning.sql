-- =============================================================
-- Monthly Planning Workflow (Roadmap Phase 3.2)
-- Plan → per-slot Briefs → brief→static production → posting queue.
-- Idempotent — safe to re-run.
-- =============================================================

-- Agency-level parent: one month's content plan (may span multiple brands).
CREATE TABLE IF NOT EXISTS monthly_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month          date NOT NULL,                    -- 1st of the target month
  title          text,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  input_config   jsonb NOT NULL DEFAULT '{}'::jsonb, -- the guided form
  -- planning | plan_ready | briefing | briefs_ready | producing | scheduled | complete | error
  status         text NOT NULL DEFAULT 'planning',
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monthly_plans_created_idx ON monthly_plans (created_at DESC);

-- The month's slots — one row per intended post.
CREATE TABLE IF NOT EXISTS plan_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  planned_date      date NOT NULL,
  asset_type        text NOT NULL DEFAULT 'static',   -- static | video
  format            text NOT NULL DEFAULT 'feed',     -- feed | story | reel
  platforms         jsonb NOT NULL DEFAULT '["facebook","instagram"]'::jsonb,
  angle_tag         text,
  topic             text,
  product_id        uuid REFERENCES client_products(id) ON DELETE SET NULL,
  title             text,
  direction         text,                             -- Claude's per-slot creative direction
  -- planned | briefing | brief_ready | producing | generated | scheduled | error | skipped
  status            text NOT NULL DEFAULT 'planned',
  brief_id          uuid,                             -- soft link to plan_briefs (avoid circular FK)
  generation_id     uuid REFERENCES static_ad_generations(id) ON DELETE SET NULL,
  scheduled_post_id uuid REFERENCES scheduled_posts(id) ON DELETE SET NULL,
  error_message     text,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_items_plan_idx ON plan_items (plan_id, sort_order);
CREATE INDEX IF NOT EXISTS plan_items_client_status_idx ON plan_items (client_id, status);
CREATE INDEX IF NOT EXISTS plan_items_status_idx ON plan_items (status);

-- One reviewable/editable brief per slot (static or video).
CREATE TABLE IF NOT EXISTS plan_briefs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id   uuid NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  brief_type     text NOT NULL,                       -- static | video
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'generating',  -- generating | ready | error
  edited         boolean NOT NULL DEFAULT false,
  ai_model       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_briefs_item_idx ON plan_briefs (plan_item_id);
