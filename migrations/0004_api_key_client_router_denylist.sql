-- Per-key client-router denylist.
--
-- An operator can now refuse a specific downstream router per API key: a key
-- resold to one, or spent by a router whose retries multiply upstream load,
-- carries the router's id in `client_router_denylist` and a request whose
-- fingerprint names it is refused before routing.
--
-- The column is nullable with no default, which is the correct starting state
-- for every existing key: NULL means "no router is refused", so this migration
-- changes no key's behaviour. It is additive only — no existing column moves,
-- and no row is rewritten.
--
-- No index. The value is read with the key row that the authentication lookup
-- already fetched by primary key, so there is no query that would use one.

ALTER TABLE "public"."api_keys"
  ADD COLUMN IF NOT EXISTS "client_router_denylist" jsonb;
