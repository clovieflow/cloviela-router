-- Stable, user-controlled ordering for lists that can be rearranged (drag to
-- reorder). Ordering by `created_at` was unstable: two rows created in the same
-- millisecond (or touched by an UPDATE) could swap places between loads, so the
-- list appeared to jump around. A dedicated integer index is explicit and can
-- be rewritten atomically when the operator drags a row.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "sort_index" integer;
--> statement-breakpoint
ALTER TABLE "model_combos" ADD COLUMN IF NOT EXISTS "sort_index" integer;
--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN IF NOT EXISTS "sort_index" integer;
--> statement-breakpoint
-- Backfill from creation order so existing tenants keep their current sequence.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) - 1 AS idx
  FROM "api_keys"
)
UPDATE "api_keys" SET "sort_index" = ordered.idx FROM ordered WHERE "api_keys".id = ordered.id;
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) - 1 AS idx
  FROM "model_combos"
)
UPDATE "model_combos" SET "sort_index" = ordered.idx FROM ordered WHERE "model_combos".id = ordered.id;
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) - 1 AS idx
  FROM "model_aliases"
)
UPDATE "model_aliases" SET "sort_index" = ordered.idx FROM ordered WHERE "model_aliases".id = ordered.id;
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "sort_index" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "sort_index" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_combos" ALTER COLUMN "sort_index" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "model_combos" ALTER COLUMN "sort_index" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_aliases" ALTER COLUMN "sort_index" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "model_aliases" ALTER COLUMN "sort_index" SET NOT NULL;
