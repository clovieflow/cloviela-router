-- Participant portal sessions.
--
-- ── Why a session table at all ──────────────────────────────────────────────
-- A participant signs in with their own Bansos key. That key is the credential
-- the gateway already issues, revokes and audits — adding a second password
-- would mean a second thing to distribute, reset and leak.
--
-- The key itself must not travel on every portal request: it is a bearer
-- credential for spending money, and a portal page is a place it would sit in
-- a cookie, a URL bar and a browser history. So it is exchanged once for a
-- session token, exactly as the console does for an operator.
--
-- ── Why the session is bound to the key, not the participant ────────────────
-- A participant may hold several keys. Binding to the key means revoking that
-- key ends its sessions and no others, which is what an operator revoking one
-- credential expects. Binding to the participant would leave every session
-- alive until they all expired.

CREATE TABLE IF NOT EXISTS "bansos_portal_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "participant_id" uuid NOT NULL REFERENCES "bansos_participants"("id") ON DELETE CASCADE,
  -- The `api_keys` row this session was opened with. `ON DELETE CASCADE` so a
  -- deleted key takes its sessions with it; revocation is checked on every
  -- request rather than relying on the cascade, because revocation sets a
  -- column and leaves the row in place.
  "key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- Only the hash is stored, for the same reason API keys store hashes: a
  -- leaked database dump must not yield a usable session.
  "session_token_hash" text NOT NULL UNIQUE,
  "ip_address" text,
  "user_agent" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "bansos_portal_sessions_participant_idx"
  ON "bansos_portal_sessions" ("participant_id");

CREATE INDEX IF NOT EXISTS "bansos_portal_sessions_key_idx"
  ON "bansos_portal_sessions" ("key_id");
