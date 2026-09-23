-- 0015: remember exactly what a video render sent to the provider.
--
-- The render (Seedance via Kie) is the last of 5–6 steps; the first ones are paid
-- Claude/GPT calls. When only the render failed — e.g. Kie's upstream outage on
-- 22 Sep 2026, answered 7 times with "Try again" — every retry re-ran all the prompt
-- steps. With the submitted payload stored, "Retry render" resubmits just the render.
--
-- Shape: { prompt: string, imageUrls: string[], aspectRatio: string, duration: number }
--
-- Additive only (idempotent). Apply by hand via scripts/apply-0015.ts — the drizzle
-- journal is stale at 0002; NEVER run drizzle-kit generate/migrate here.

ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS provider_input jsonb;
