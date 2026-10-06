-- Cutoff: `telemetry_payloads` is a short-TTL index into on-disk payload
-- frames. The previous `request_body jsonb` column structurally allowed a
-- captured body (or a JSON wrapper around a file ref) to land in Postgres.
-- Replace it with typed reference columns so bodies cannot be stored here.
--
-- Existing index rows are discarded. Frame files are left untouched — prune
-- still reclaims them by TTL — so this is not a rewrite of the body store.
-- At most one payload-retention window of drawer lookups is lost at deploy.

TRUNCATE TABLE "telemetry_payloads";
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" DROP COLUMN IF EXISTS "request_body";
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD COLUMN IF NOT EXISTS "storage" text;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD COLUMN IF NOT EXISTS "file" text;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD COLUMN IF NOT EXISTS "offset" integer;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD COLUMN IF NOT EXISTS "length" integer;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD COLUMN IF NOT EXISTS "checksum" text;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD COLUMN IF NOT EXISTS "version" integer;
--> statement-breakpoint
-- A partial prior attempt could leave null-typed columns; drop those rows
-- before enforcing NOT NULL. TRUNCATE above already emptied a clean run.
DELETE FROM "telemetry_payloads"
WHERE "storage" IS NULL
   OR "file" IS NULL
   OR "offset" IS NULL
   OR "length" IS NULL
   OR "checksum" IS NULL
   OR "version" IS NULL;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ALTER COLUMN "storage" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ALTER COLUMN "file" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ALTER COLUMN "offset" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ALTER COLUMN "length" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ALTER COLUMN "checksum" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ALTER COLUMN "version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" DROP CONSTRAINT IF EXISTS "telemetry_payloads_storage_check";
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD CONSTRAINT "telemetry_payloads_storage_check" CHECK ("storage" = 'jsonb-file');
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" DROP CONSTRAINT IF EXISTS "telemetry_payloads_version_check";
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD CONSTRAINT "telemetry_payloads_version_check" CHECK ("version" = 1);
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" DROP CONSTRAINT IF EXISTS "telemetry_payloads_offset_check";
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD CONSTRAINT "telemetry_payloads_offset_check" CHECK ("offset" >= 0);
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" DROP CONSTRAINT IF EXISTS "telemetry_payloads_length_check";
--> statement-breakpoint
ALTER TABLE "telemetry_payloads" ADD CONSTRAINT "telemetry_payloads_length_check" CHECK ("length" > 0);
