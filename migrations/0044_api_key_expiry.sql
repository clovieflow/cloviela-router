-- Key expiry for Bansos keys.
--
-- ── The bug this fixes ──────────────────────────────────────────────────────
-- The key-issuing API accepted `expiresAt` from the first version. The column
-- did not exist, so the insert silently dropped it: an operator could set an
-- expiry date, receive `200 OK`, and the key would keep working forever. A
-- limit that is accepted and discarded is worse than one that is refused,
-- because the operator has no way to notice.
--
-- ── Why the check is here and not in the application ────────────────────────
-- Authentication reads the key row directly (`findActiveByHash`), so an
-- expired key must fail that same lookup. Putting the condition in the SQL
-- means an expired key cannot be reached by any code path that forgot to check
-- a timestamp in JavaScript.
--
-- `expires_at IS NULL` means "never expires", which is the state every
-- existing key is in, so the migration is a no-op for rows already present.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "api_keys_expires_at_idx"
  ON "api_keys" ("expires_at") WHERE "expires_at" IS NOT NULL;

COMMENT ON COLUMN "api_keys"."expires_at" IS
  'When this key stops working. NULL = never. Enforced in the authentication lookup.';
