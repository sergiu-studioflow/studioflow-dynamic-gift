-- =============================================================
-- Scheduling + Auto-Posting Integration (Roadmap Phase 3.1)
-- FB + IG at launch (LinkedIn later via platform='linkedin' rows).
-- Idempotent — safe to re-run.
-- =============================================================

-- One row per brand × platform. One agency Meta System User token (vault
-- key META_SYSTEM_USER_TOKEN) serves every row; only the external ids differ.
CREATE TABLE IF NOT EXISTS social_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform           text NOT NULL,                 -- facebook | instagram | linkedin(later)
  external_id        text NOT NULL,                 -- FB page_id or IG ig_user_id
  external_name      text,                          -- fetched on Test Connection
  enabled            boolean NOT NULL DEFAULT true,
  health             text NOT NULL DEFAULT 'unverified', -- unverified | ok | token_invalid | error
  health_checked_at  timestamptz,
  health_error       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_accounts_client_platform_unique UNIQUE (client_id, platform)
);
CREATE INDEX IF NOT EXISTS social_accounts_client_idx ON social_accounts (client_id);

-- Parent: one creative + one schedule slot. source_snapshot survives deletion
-- of the source row (soft FKs SET NULL).
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id                   uuid REFERENCES users(id) ON DELETE SET NULL,
  source_type               text NOT NULL,          -- static_ad | winner | video | review_graphic | manual
  source_generation_id      uuid REFERENCES static_ad_generations(id) ON DELETE SET NULL,
  source_winner_id          uuid REFERENCES winners_library(id) ON DELETE SET NULL,
  source_video_id           uuid REFERENCES video_generations(id) ON DELETE SET NULL,
  source_review_graphic_id  uuid REFERENCES review_graphics(id) ON DELETE SET NULL,
  source_snapshot           jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_type                text NOT NULL DEFAULT 'image',   -- image | video
  media_url                 text NOT NULL,          -- R2 public URL
  media_width               integer,
  media_height              integer,
  status                    text NOT NULL DEFAULT 'generating',
    -- generating | draft | scheduled | publishing | published | partial | failed | cancelled
  scheduled_at              timestamptz,            -- stored UTC
  timezone                  text NOT NULL DEFAULT 'Australia/Sydney', -- IANA (DST-safe)
  approved_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at               timestamptz,
  angle_tag                 text,                   -- which of the 5 core angles captions used
  error_message             text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_posts_client_created_idx ON scheduled_posts (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scheduled_posts_status_sched_idx ON scheduled_posts (status, scheduled_at);

-- Child: one row per platform. FB and IG publish/retry independently.
CREATE TABLE IF NOT EXISTS post_targets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id               uuid NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE, -- denorm for scoped queries
  social_account_id     uuid REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform              text NOT NULL,             -- facebook | instagram
  placement             text NOT NULL DEFAULT 'feed', -- feed | story | reel
  caption               text,
  hashtags              jsonb NOT NULL DEFAULT '[]'::jsonb, -- string[] without '#'
  caption_payload       jsonb,                     -- { hook_line, cta, alt_text }
  media_override_url     text,                     -- re-encoded / per-platform variant
  enabled               boolean NOT NULL DEFAULT true,
  status                text NOT NULL DEFAULT 'pending', -- pending | publishing | published | failed | skipped
  attempt_count         integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  claimed_at            timestamptz,               -- stamped in the atomic claim, BEFORE any external call
  ig_container_id       text,                      -- IG creation_id — persists across cron runs
  ig_publish_started_at timestamptz,              -- ambiguity fence: stamped just before media_publish
  external_post_id      text,                      -- FB post id / IG media id — idempotency proof
  external_permalink    text,
  published_at          timestamptz,
  error_code            text,                      -- token_invalid | media_error | rate_limited | quota_exceeded | ambiguous_stuck | unknown
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_targets_post_platform_unique UNIQUE (post_id, platform)
);
CREATE INDEX IF NOT EXISTS post_targets_status_next_idx ON post_targets (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS post_targets_client_status_idx ON post_targets (client_id, status);
