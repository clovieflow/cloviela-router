-- The share popup no longer has a donation/information "type": it is a single
-- popup whose copy the owner edits freely, so the mode text collapses into a
-- plain on/off flag. Existing rows that had a mode keep the popup on.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_enabled" boolean;
--> statement-breakpoint
UPDATE "api_keys" SET "share_popup_enabled" = ("share_popup_mode" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_share_popup_mode_check";
--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "share_popup_mode";
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "share_popup_enabled" SET DEFAULT false;
--> statement-breakpoint
UPDATE "api_keys" SET "share_popup_enabled" = false WHERE "share_popup_enabled" IS NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "share_popup_enabled" SET NOT NULL;
