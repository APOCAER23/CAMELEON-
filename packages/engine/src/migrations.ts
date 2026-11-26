import type { Migration } from '@cameleon/kit';

/**
 * Append-only. NEVER edit a released migration (its checksum is verified at startup) —
 * add a new one instead.
 */
export const migrations: Migration[] = [
  {
    id: 1,
    name: 'core',
    sql: `
      CREATE TABLE credentials (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        masked_key TEXT,
        fields_json TEXT NOT NULL DEFAULT '{}',
        secret_fields_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (provider_id, label)
      );
      CREATE INDEX idx_credentials_provider ON credentials (provider_id);

      CREATE TABLE custom_providers (
        id TEXT PRIMARY KEY,
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider_id TEXT,
        message TEXT NOT NULL
      );
      CREATE INDEX idx_activity_ts ON activity (ts DESC);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: 'models',
    // Filled by provider adapters in Phase 2. Capability columns use JSON with 3 states: supported | unsupported | unknown.
    sql: `
      CREATE TABLE models (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        protocol TEXT NOT NULL,
        context_window INTEGER,
        max_output_tokens INTEGER,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        pricing_json TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        origin TEXT NOT NULL DEFAULT 'discovered',
        synced_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id)
      );
    `,
  },
  {
    id: 3,
    name: 'connection-checks-and-model-kind',
    sql: `
      -- Last live connection test per credential. Deleted whenever the credential changes (stale results never linger).
      CREATE TABLE connection_checks (
        credential_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('connected', 'failed')),
        checked_at TEXT NOT NULL,
        latency_ms INTEGER,
        http_status INTEGER,
        message TEXT NOT NULL
      );
      ALTER TABLE models ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown';
      CREATE INDEX idx_models_provider ON models (provider_id);
    `,
  },
  {
    id: 4,
    name: 'profiles-and-launches',
    sql: `
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        agent_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        credential_label TEXT,
        launch_args_json TEXT NOT NULL DEFAULT '[]',
        project_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- One row per agent session started through CAMELEON (the local, measured part of future usage analytics).
      CREATE TABLE launches (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        profile_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        exit_code INTEGER,
        signal TEXT
      );
      CREATE INDEX idx_launches_started ON launches (started_at DESC);
    `,
  },
  {
    id: 5,
    name: 'custom-agents',
    sql: `
      CREATE TABLE custom_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        binary TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        protocols_json TEXT NOT NULL DEFAULT '["openai","anthropic"]',
        model_flag TEXT NOT NULL DEFAULT '',
        extra_args_json TEXT NOT NULL DEFAULT '[]',
        env_template_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 6,
    name: 'token-usage',
    sql: `
      CREATE TABLE token_usage (
        id TEXT PRIMARY KEY,
        launch_id TEXT,
        agent_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        protocol TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        status_code INTEGER NOT NULL DEFAULT 200,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_token_usage_created ON token_usage (created_at DESC);
      CREATE INDEX idx_token_usage_model ON token_usage (provider_id, model_id);
    `,
  },
];
