-- The share popup art is uploaded and served from this row instead of being
-- referenced by a remote URL. A URL leaked each visitor's IP to a third party
-- and silently broke when the host moved; bytes in Postgres are the one source
-- the share page can always reach.
--
-- Any previously stored URL is dropped: there is no way to fetch and re-host it
-- from here without pulling third-party content server-side.
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "share_popup_image_url";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_image" bytea;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "share_popup_image_mime" text;
--> statement-breakpoint
-- A mime is meaningful only alongside bytes; keep the pair consistent.
DELETE FROM "api_keys"
WHERE ("share_popup_image" IS NULL) <> ("share_popup_image_mime" IS NULL);
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_share_popup_image_mime_check";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_share_popup_image_mime_check"
  CHECK ("share_popup_image_mime" IS NULL
    OR "share_popup_image_mime" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'));
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_share_popup_image_size_check";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_share_popup_image_size_check"
  CHECK ("share_popup_image" IS NULL OR octet_length("share_popup_image") <= 2097152);
