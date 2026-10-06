-- Optional donation/information image popup attached to a key's public share page.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_mode" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_image_url" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_title" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_body" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_action_label" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_action_url" text;
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_share_popup_mode_check";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_share_popup_mode_check"
  CHECK ("share_popup_mode" IS NULL OR "share_popup_mode" IN ('donation', 'information'));
