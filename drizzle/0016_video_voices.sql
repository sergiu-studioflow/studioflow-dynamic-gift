-- 0016: voice + model choice for Video Generation.
--
-- Dynamic Gift asked to choose Australian accents and male/female voices. Tested 30 Sep 2026:
-- passing an ElevenLabs voice's preview clip to Seedance as reference audio switches the
-- spoken accent (American → Australian on both 2.0 and 2.5) with no change to the prompt.
--
-- video_voices: voices synced from the ElevenLabs account, preview re-hosted on R2.
-- video_generations.voice_id / video_model: what each render used, so a retry keeps it.
--
-- Additive only (idempotent). Apply by hand via scripts/apply-0016.ts — the drizzle journal
-- is stale at 0002; NEVER run drizzle-kit generate/migrate here.

CREATE TABLE IF NOT EXISTS video_voices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_id text NOT NULL UNIQUE,
  name text NOT NULL,
  gender text,
  age text,
  accent text,
  description text,
  preview_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS voice_id text;
ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS video_model text NOT NULL DEFAULT 'seedance-2';
