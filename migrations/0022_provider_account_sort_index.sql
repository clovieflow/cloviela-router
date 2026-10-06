-- Stable, operator-controlled ordering for provider accounts.
--
-- Accounts were ordered by `created_at`, which is not stable: two rows created
-- in the same millisecond, or a row touched by an UPDATE, could swap places
-- between loads, so the list appeared to jump on its own. A dedicated integer
-- index is explicit, survives reloads, and can be rewritten when the operator
-- reorders rows or adds one.
--
-- Scope is (tenant_id, provider_id): accounts are listed per provider, and the
-- same tenant can hold accounts for several providers, so the counter must not
-- run across providers or the first account of a second provider would land at
-- a high index.
ALTER TABLE "provider_accounts" ADD COLUMN IF NOT EXISTS "sort_index" integer;
--> statement-breakpoint
-- Backfill from creation order so existing accounts keep the sequence they had.
WITH ordered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY provider_id, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
           ORDER BY created_at, id
         ) - 1 AS idx
  FROM "provider_accounts"
)
UPDATE "provider_accounts" SET "sort_index" = ordered.idx
  FROM ordered WHERE "provider_accounts".id = ordered.id;
--> statement-breakpoint
ALTER TABLE "provider_accounts" ALTER COLUMN "sort_index" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "provider_accounts" ALTER COLUMN "sort_index" SET NOT NULL;
