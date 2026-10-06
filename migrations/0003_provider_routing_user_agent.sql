ALTER TABLE provider_routing_settings
  ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT 'codex_cli_rs/0.156.1';
