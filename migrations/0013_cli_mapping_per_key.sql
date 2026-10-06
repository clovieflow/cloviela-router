-- Per-API-key CLI tool mappings: each key can target different models
-- for the same CLI slot. Previously mappings were per-(tenant, tool);
-- now they are per-(tenant, tool, api_key_id) so different keys can have
-- independent source→target routes.
--
-- Existing rows: assign to the default API key of the tenant (NULL means
-- "legacy / no key assigned"). We use NULL as the migration sentinel and
-- clean them up so the new unique index can enforce the per-key invariant.

-- 1. Wipe legacy global rows — they had no key owner and cannot be
--    attributed to a specific key without operator input.
DELETE FROM "cli_tool_mappings";
DELETE FROM "cli_tool_settings";

-- 2. Add the new foreign-key column.
ALTER TABLE "cli_tool_mappings"
  ADD COLUMN IF NOT EXISTS "api_key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE;

ALTER TABLE "cli_tool_settings"
  ADD COLUMN IF NOT EXISTS "api_key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE;

-- 3. Drop the old unique indexes and replace with per-key variants.
DROP INDEX IF EXISTS "cli_tool_mappings_key";
CREATE UNIQUE INDEX "cli_tool_mappings_key"
  ON "cli_tool_mappings" ("tenant_id", "tool_id", "api_key_id", "slot_key");

ALTER TABLE "cli_tool_settings" DROP CONSTRAINT IF EXISTS "cli_tool_settings_tenant_id_tool_id_pk";
ALTER TABLE "cli_tool_settings" DROP CONSTRAINT IF EXISTS "cli_tool_settings_pkey";
ALTER TABLE "cli_tool_settings"
  ADD CONSTRAINT "cli_tool_settings_pkey" PRIMARY KEY ("tenant_id", "tool_id", "api_key_id");
