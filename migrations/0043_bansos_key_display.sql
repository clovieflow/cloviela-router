-- Store the Bansos key secret, encrypted, so an operator can hand it out.
--
-- ── Why this reverses the original decision ─────────────────────────────────
-- Bansos keys were hash-only on the reasoning that a credential issued to a
-- third party has no need to be read back. That was wrong for how the feature
-- is actually used: one operator creates every key and distributes them, so a
-- key that can only be read once means the operator either copies it into a
-- note they then have to keep, or revokes and reissues whenever they lose it.
--
-- The column is the same one personal keys already have (`key_encrypted`,
-- AES-GCM under `CLOVIELA_ENCRYPTION_KEY`). The hash stays authoritative for
-- authentication; this is a copy for display, and it is never returned by a
-- participant-facing endpoint.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_encrypted" bytea;

COMMENT ON COLUMN "api_keys"."key_encrypted" IS
  'AES-GCM copy of the secret for operator display. Authentication uses key_hash; this is never sent to a participant.';
