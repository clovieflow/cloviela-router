-- Rename the default gateway API key's label after the product rename.
--
-- ── The bug this fixes ──────────────────────────────────────────────────────
-- Setup creates one gateway key and Studio looks it up *by label*
-- (`DEFAULT_API_KEY_LABEL`). The product rename changed that constant from
-- "Default Cartethyia API key" to "Default Cloviela API key" — but the rows
-- already in the database kept the old label, and nothing migrated them.
--
-- So on every installation that existed before the rename, Studio failed with
-- `default_key_missing: the default gateway API key is missing; complete
-- console setup to create it`. The key was there the whole time; only its name
-- had moved. Worse, the message tells the operator to re-run setup, which is
-- both unnecessary and destructive advice.
--
-- ── Why a rename and not a lookup that tolerates both ───────────────────────
-- The lookup could match either spelling, but then the label would keep
-- drifting as the product is renamed again, and the "founding key" would
-- accumulate aliases forever. Renaming the row settles it in the one place
-- that owns the value.
--
-- Scoped to the exact old label so an operator's own key cannot be touched.

UPDATE "api_keys"
SET "label" = 'Default Cloviela API key'
WHERE "label" = 'Default Cartethyia API key';
