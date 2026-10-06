ALTER TABLE "telemetry_events" ADD COLUMN IF NOT EXISTS "credit_used" numeric(12, 4);
--> statement-breakpoint
