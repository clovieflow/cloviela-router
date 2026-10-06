-- The share popup's action button (label + URL) is removed: the popup is now
-- image, title, and message only. Drop the two columns rather than leave them
-- as dead keys nothing reads.
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "share_popup_action_label";
--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "share_popup_action_url";
