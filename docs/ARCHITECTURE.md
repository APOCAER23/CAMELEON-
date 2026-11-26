# Architecture (Phase 1)

```
 Desktop (Electron)           CLI
   renderer ──IPC──► main      │
        (no token)      │      │  both read  <data>/runtime.json (0600): port + token
                        ▼      ▼
                 ┌───────────────────┐   127.0.0.1 only · Host/Origin guard · Bearer token
                 │  CAMELEON engine  │   rate-limit · 64 KiB body limit · Zod validation
                 └───┬───────────┬───┘
                     │           │
              SQLite (metadata)  Vault (secrets)
              cameleon.db        OS keychain  ─or─  AES-256-GCM file
```

## What SQLite is for
Metadata only — never secrets: provider credential *records* (label, masked hint `sk-or-…a1b2`, non-secret fields, enabled flag,
a pointer `cred:<id>` into the vault), custom providers, the model registry cache (Phase 2), the activity log (pruned to 1000 rows),
settings, and the schema-migration ledger (checksummed, downgrade-protected). One file, transactional, shared by CLI and desktop
through the engine, so a change in one interface appears in the other.

## Secret handling
1. API key arrives over loopback HTTP, is validated, split from non-secret fields.
2. Secret fields go to the vault (`cred:<id>` → JSON). Keychain is probed (write/read/delete); otherwise AES-256-GCM file with a 0600 master key, entries bound to their name via AAD.
3. SQLite receives only the masked hint. Lists never touch the vault.
4. `CredentialService.getSecrets()` is internal (used by the Phase 3 launcher); no HTTP route returns secrets.
5. Logs/activity pass through redaction; error handlers never echo request bodies.

## Adding a provider (no core change)
Drop a JSON file in `<config>/providers.d/` (validated with the same Zod schema), or create it in the UI/CLI (stored in SQLite), or add an entry to `packages/engine/src/catalog/builtin.ts`.

## Desktop security
`contextIsolation`, `sandbox`, no Node in renderer, strict CSP (meta tag, works on file://), navigation/popup/webview/permission lockdown,
IPC sender check, route allow-list (shutdown is not reachable from the UI), token never leaves the main process.
Packaging note: the engine uses `better-sqlite3` (Node ABI), so the desktop spawns a real Node binary (`CAMELEON_NODE`); installers (Phase 6) will bundle one.

## Phase 2 additions
- `connection_checks` (schema v3): last live test per credential; deleted whenever the credential changes, so a stale "connected" can never linger.
  Provider status: `connected` (an enabled credential last tested OK) · `error` (enabled credentials, all failing) · `configured` (never tested) · `disabled` · `not_configured`.
- `models` registry: discovered / curated / manual rows. Sync replaces discovered+curated rows atomically, keeps manual ones, refuses to replace a populated cache with an empty answer, and is only triggered on demand or after a configuration change (no polling).
- Test-before-save: `POST /v1/providers/:id/test` validates with the same rules as saving, runs the adapter, stores nothing.
- Desktop IPC allow-list covers the new routes (unit-tested); `/v1/engine/shutdown` stays unreachable from the UI.

## Phase 3–4 additions
- `agents/` (specs + detection), `compat/engine.ts`, `services/launcher.ts` (plans, sessions), `services/profiles.ts`; schema v4 adds `profiles` and `launches`.
- Launch flow: CLI ⇄ engine (`/v1/launch/prepare`) → temp files + env → real agent via execa → `/v1/launch/:id/finish`.
- Desktop: IPC allow-list extended (agents, compat, profiles, diagnostics, `launch/inspect`); new IPC for terminal opening, folder picker, engine restart/logs, system info, settings (login item, default agent). `findExecutable` lives in `@cameleon/kit`.
- Active profile = `settings.activeProfileId`; profile compatibility is recomputed live (a removed model shows `model_missing`).

## Roadmap hooks already in place
`models` table with capability/pricing/kind (used by the Phase 3 compatibility engine), `endpoints` per protocol + `discovery` descriptor on every provider, `getSecrets()` for the launcher,
`startDaemon(nodeBin)` for any host process.
