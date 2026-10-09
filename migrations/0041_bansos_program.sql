-- Bansos AI API: administrator-managed subsidized access program.
--
-- ── What this adds, and what it deliberately does not ───────────────────────
-- The gateway already enforces token quotas, request rate limits, concurrency
-- and model allowlists per API key (`api_keys` + `ApiKeyAdmissionService`), and
-- already routes every dispatch through provider adapters. Bansos is therefore
-- a *policy layer* over that machinery, not a second gateway: it groups keys
-- under a program, attaches a participant identity to them, and pins which
-- upstream provider and models the program may spend on.
--
-- Nothing here duplicates quota accounting, rate limiting or routing. A Bansos
-- key is an `api_keys` row with `key_mode = 'bansos'`, so it inherits the
-- existing admission, caching, revocation and telemetry paths unchanged.

-- ── Programs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bansos_programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  -- Administrator-only. Never returned by a participant-facing endpoint.
  "admin_notes" text,
  "enabled" boolean NOT NULL DEFAULT true,

  -- Enrollment policy. `open` still requires administrator approval unless
  -- `auto_approve` is set, so a public program cannot silently hand out
  -- upstream spend.
  "enrollment_mode" text NOT NULL DEFAULT 'closed'
    CHECK ("enrollment_mode" IN ('closed', 'invite', 'request', 'open')),
  "auto_approve" boolean NOT NULL DEFAULT false,
  "max_participants" integer CHECK ("max_participants" IS NULL OR "max_participants" > 0),
  "terms_required" boolean NOT NULL DEFAULT false,
  "terms_text" text,

  -- Global policy. NULL means "not configured" and is treated as unlimited by
  -- the resolver; a 0 is rejected at the API layer so an accidental zero can
  -- never be mistaken for "no access".
  "global_rpm" integer CHECK ("global_rpm" IS NULL OR "global_rpm" > 0),
  "global_concurrency" integer CHECK ("global_concurrency" IS NULL OR "global_concurrency" > 0),
  "global_token_budget" bigint CHECK ("global_token_budget" IS NULL OR "global_token_budget" > 0),
  "daily_token_budget" bigint CHECK ("daily_token_budget" IS NULL OR "daily_token_budget" > 0),
  "monthly_token_budget" bigint CHECK ("monthly_token_budget" IS NULL OR "monthly_token_budget" > 0),

  -- Per-request ceilings applied to every participant unless overridden.
  "max_input_tokens" integer CHECK ("max_input_tokens" IS NULL OR "max_input_tokens" > 0),
  "max_output_tokens" integer CHECK ("max_output_tokens" IS NULL OR "max_output_tokens" > 0),
  "max_request_bytes" bigint CHECK ("max_request_bytes" IS NULL OR "max_request_bytes" > 0),
  "max_request_duration_ms" integer CHECK ("max_request_duration_ms" IS NULL OR "max_request_duration_ms" > 0),
  "max_stream_duration_ms" integer CHECK ("max_stream_duration_ms" IS NULL OR "max_stream_duration_ms" > 0),
  "max_keys_per_participant" integer NOT NULL DEFAULT 3
    CHECK ("max_keys_per_participant" > 0),

  -- Default allowance granted to a new participant, in tokens. NULL = the
  -- program's own budget is the only ceiling.
  "default_token_allowance" bigint CHECK ("default_token_allowance" IS NULL OR "default_token_allowance" > 0),
  "default_rpm" integer CHECK ("default_rpm" IS NULL OR "default_rpm" > 0),
  "default_concurrency" integer CHECK ("default_concurrency" IS NULL OR "default_concurrency" > 0),

  "starts_at" timestamptz,
  "ends_at" timestamptz,

  -- The upstream credential this program is allowed to spend. A Bansos request
  -- can only ever be served by an account assigned here; the router's full
  -- provider set is not reachable from a Bansos key.
  "provider_id" text,
  "provider_account_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bansos_programs_slug_unique" UNIQUE ("tenant_id", "slug"),
  CONSTRAINT "bansos_programs_window" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE INDEX IF NOT EXISTS "bansos_programs_tenant_idx" ON "bansos_programs" ("tenant_id");

-- ── Participants ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bansos_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "bansos_programs"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "display_name" text NOT NULL,
  "email" text,
  "external_ref" text,
  "status" text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'active', 'suspended', 'revoked')),
  "admin_notes" text,

  -- Per-participant overrides. NULL falls back to the program default; the
  -- resolver takes the *most restrictive* applicable value, so an override can
  -- only ever tighten what the program allows unless the program is silent.
  "token_allowance" bigint CHECK ("token_allowance" IS NULL OR "token_allowance" > 0),
  "rpm" integer CHECK ("rpm" IS NULL OR "rpm" > 0),
  "concurrency" integer CHECK ("concurrency" IS NULL OR "concurrency" > 0),
  "model_allowlist" jsonb,

  -- Consumed tokens are tracked on the participant so a suspended or revoked
  -- participant's history survives, and so an allowance reset has something to
  -- reset. The per-key counters in `api_keys` remain the enforcement source.
  "tokens_consumed" bigint NOT NULL DEFAULT 0,
  "period_started_at" timestamptz NOT NULL DEFAULT now(),

  "approved_at" timestamptz,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bansos_participants_email_unique" UNIQUE ("program_id", "email")
);

CREATE INDEX IF NOT EXISTS "bansos_participants_program_idx" ON "bansos_participants" ("program_id");
CREATE INDEX IF NOT EXISTS "bansos_participants_status_idx" ON "bansos_participants" ("program_id", "status");

-- ── Subsidized models ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bansos_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid NOT NULL REFERENCES "bansos_programs"("id") ON DELETE CASCADE,
  -- The upstream model id the router resolves. Must already exist in the
  -- provider's catalog; this table never invents a model.
  "upstream_model_id" text NOT NULL,
  -- What the participant sees and sends. Defaults to the upstream id.
  "public_model_id" text NOT NULL,
  "display_name" text,
  "enabled" boolean NOT NULL DEFAULT true,
  -- Per-model ceilings, applied on top of the program and participant ones.
  "max_input_tokens" integer CHECK ("max_input_tokens" IS NULL OR "max_input_tokens" > 0),
  "max_output_tokens" integer CHECK ("max_output_tokens" IS NULL OR "max_output_tokens" > 0),
  "daily_token_budget" bigint CHECK ("daily_token_budget" IS NULL OR "daily_token_budget" > 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bansos_models_public_unique" UNIQUE ("program_id", "public_model_id")
);

CREATE INDEX IF NOT EXISTS "bansos_models_program_idx" ON "bansos_models" ("program_id", "enabled");

-- ── Audit ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bansos_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "program_id" uuid REFERENCES "bansos_programs"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "actor_kind" text NOT NULL CHECK ("actor_kind" IN ('admin', 'participant', 'system')),
  "actor_id" text,
  "action" text NOT NULL,
  "target_kind" text,
  "target_id" text,
  -- Metadata only. Never a key secret: the API layer strips anything that
  -- looks like a credential before it reaches this column.
  "detail" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "bansos_audit_program_idx" ON "bansos_audit_events" ("program_id", "created_at" DESC);

-- ── API keys gain a Bansos mode ─────────────────────────────────────────────
-- A Bansos key is an ordinary `api_keys` row. It inherits the existing hash,
-- scope, revocation, admission and telemetry paths, so nothing about key
-- authentication changes; only the mode value is new, and the participant
-- link below is what makes it a Bansos credential.
-- The existing shape check is `api_keys_mode_shape_check`, and it enumerates
-- the permitted shapes for `personal` and `share`. A `bansos` row would fail
-- it, so the constraint is replaced rather than supplemented. A Bansos key has
-- the personal shape — a stored hash and no parent — which is exactly what the
-- first branch already describes, so only the mode name is added.
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_mode_shape_check";
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_mode_shape_check" CHECK (
  ("key_mode" IN ('personal', 'bansos') AND "key_hash" IS NOT NULL AND "parent_key_id" IS NULL
    AND "issued_client_ip" IS NULL AND "issued_client_ip_key" IS NULL)
  OR
  ("key_mode" = 'share' AND (
    ("parent_key_id" IS NULL AND "key_hash" IS NULL
      AND "key_encrypted" IS NULL
      AND "issued_client_ip" IS NULL AND "issued_client_ip_key" IS NULL)
    OR
    ("parent_key_id" IS NOT NULL AND "key_hash" IS NOT NULL
      AND "key_encrypted" IS NULL
      AND "issued_client_ip" IS NOT NULL AND "issued_client_ip_key" IS NOT NULL)
  ))
);

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "bansos_participant_id" uuid
  REFERENCES "bansos_participants"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "api_keys_bansos_participant_idx"
  ON "api_keys" ("bansos_participant_id") WHERE "bansos_participant_id" IS NOT NULL;
