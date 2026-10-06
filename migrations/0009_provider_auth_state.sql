ALTER TABLE "provider_accounts" ADD COLUMN IF NOT EXISTS "auth_state" jsonb;
--> statement-breakpoint
ALTER TABLE "provider_oauth_states" ADD COLUMN IF NOT EXISTS "client_secret_ciphertext" bytea;
--> statement-breakpoint
