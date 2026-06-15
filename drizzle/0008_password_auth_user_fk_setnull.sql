-- Password-login migration: make user-referencing FKs delete-safe.
--
-- Switching to admin-managed password auth means admins can hard-delete users
-- from Settings → User management. Deleting an auth user cascades to the portal
-- `users` row, but content/audit tables referenced `users(id)` with the default
-- NO ACTION rule, which blocked deletion of any user who had ever generated an
-- asset or written an activity-log row. Flip all five to ON DELETE SET NULL so
-- the content survives (de-attributed) and the delete succeeds.
--
-- Idempotent: drops the existing constraint if present, then recreates it with
-- the SET NULL rule. Safe to re-run.

DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOR t, c IN
    SELECT * FROM (VALUES
      ('activity_log',          'activity_log_user_id_fkey'),
      ('research_briefs',       'research_briefs_user_id_fkey'),
      ('static_ad_generations', 'static_ad_generations_user_id_fkey'),
      ('video_generations',     'video_generations_user_id_fkey'),
      ('winners_library',       'winners_library_user_id_fkey')
    ) AS v(t, c)
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, c);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL',
      t, c
    );
  END LOOP;
END $$;
