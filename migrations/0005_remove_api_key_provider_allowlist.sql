-- Provider selection is no longer an API-key policy; model restrictions and scopes remain.
ALTER TABLE "public"."api_keys"
  DROP COLUMN IF EXISTS "provider_allowlist";
