-- Bansos becomes a property of an API key, not a separate program.
--
-- ── What changed and why ────────────────────────────────────────────────────
-- The first version modelled Bansos as programs, participants, subsidized
-- models and separately-issued keys. That is the shape of a SaaS product with
-- many tenants, and it is not what this feature is for: one operator hands out
-- subsidized access to a group of people, and the things they actually choose
-- are "which key", "which models", "how fast", and "how many tokens".
--
-- Every one of those is already a column on `api_keys`. A Bansos key is an
-- ordinary key that has been published; nothing about it needs its own table.
-- The layer above it was four tables of ceremony around settings the key
-- already carried, and it made the ordinary job — publish a key — into a
-- seven-step workflow.
--
-- ── What is kept ────────────────────────────────────────────────────────────
-- `key_encrypted` stays: the public page shows the key, so a copy must be
-- readable. `expires_at` stays: it is a real key property that now works.
-- Both were added for the old model and are correct for the new one.

-- ── The flag ────────────────────────────────────────────────────────────────
-- Named `bansos_enabled` rather than reusing `key_mode = 'bansos'`, because
-- `key_mode` participates in the shape constraint and is set at creation. A
-- key should be publishable and unpublishable afterwards, which is a boolean,
-- not a mode.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "bansos_enabled" boolean NOT NULL DEFAULT false;

-- The public page lists published keys; this keeps that lookup off a scan.
CREATE INDEX IF NOT EXISTS "api_keys_bansos_enabled_idx"
  ON "api_keys" ("bansos_enabled") WHERE "bansos_enabled" = true;

COMMENT ON COLUMN "api_keys"."bansos_enabled" IS
  'Published on the public Bansos page. Model allowlist, rate limits and token budget are the key''s own columns.';

-- ── Carry the old flags across ──────────────────────────────────────────────
-- A key issued under the program model was already a Bansos key; it should not
-- silently become private. The join is guarded so the migration still runs on
-- a database where the old tables were never created.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bansos_participants'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
      AND column_name = 'bansos_participant_id'
  ) THEN
    UPDATE "api_keys" SET "bansos_enabled" = true
    WHERE "bansos_participant_id" IS NOT NULL AND "revoked_at" IS NULL;
  END IF;
END $$;

-- ── Retire the program layer ────────────────────────────────────────────────
-- Dropped rather than hidden: leaving four unused tables behind would make the
-- schema describe a feature that no longer exists, and the next person to read
-- it would have to work out which of the two models is live.
DROP TABLE IF EXISTS "bansos_portal_sessions";
DROP TABLE IF EXISTS "bansos_audit_events";
DROP TABLE IF EXISTS "bansos_models";
DROP TABLE IF EXISTS "bansos_programs" CASCADE;
DROP TABLE IF EXISTS "bansos_participants" CASCADE;
