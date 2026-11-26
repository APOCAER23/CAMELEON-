# Reusable modules (`@cameleon/kit`, `@cameleon/shared`)

Copy the folder or publish it — no CAMELEON-specific code inside kit.

| Module | What it gives you | One-liner |
|---|---|---|
| `getAppPaths` | OS-correct config/data/cache/logs dirs, `<APP>_HOME` override | `getAppPaths('myapp')` |
| `runMigrations` | Checksummed, transactional SQLite migrations + downgrade guard; works with better-sqlite3 **and** node:sqlite | `runMigrations(db, [{id:1,name:'init',sql:'…'}])` |
| `openVault` | Secret store: OS keychain (probed) → AES-256-GCM file fallback | `const {store,info} = await openVault({service:'myapp', dir})` |
| `redact` / `maskSecret` | Deep log redaction, `sk-or-…a1b2` hints | `log(redact(obj))` |
| `createRequestGuard` | Framework-agnostic localhost API guard: Host allow-list, Origin, Sec-Fetch-Site, constant-time token | see `engine/src/app.ts` |
| `writeRuntime` / `readRuntime` | Daemon discovery file (port + token, 0600), pid liveness | `writeRuntime(file, info)` |
| `createEngineClient(conn, fetchImpl)` | Typed client with injectable transport (HTTP in CLI, IPC in Electron) | `createEngineClient(c, ipcFetch)` |
| `validateValues` pattern | Schema-driven form validation shared by UI & CLI | `engine/src/services/validation.ts` |
