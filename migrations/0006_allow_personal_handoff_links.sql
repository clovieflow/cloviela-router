-- Existing databases may still have the enroll-only check; personal keys need handoff links.
ALTER TABLE "public"."share_links"
  DROP CONSTRAINT IF EXISTS "share_links_kind_check";
ALTER TABLE "public"."share_links"
  ADD CONSTRAINT "share_links_kind_check"
  CHECK ("kind" IN ('enroll', 'handoff'));
