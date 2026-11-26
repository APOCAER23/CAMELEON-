# CAMELEON — Phases 3 & 4

> **One CLI. Every Provider. Every Agent.** — *Configure once. Use everywhere.*

Phase 1 = foundation (monorepo, secure engine, CLI, SQLite, vault, 16-provider registry, Electron shell).
**Phase 2 = real provider integrations**: test-before-save connection checks, per-credential connection status,
model discovery for OpenRouter, OpenAI, Anthropic, DeepSeek, Ollama (+ Gemini and every OpenAI-compatible provider),
a model registry with capability filters / comparison / manual models, and the matching CLI + desktop screens.
See `docs/PROVIDERS.md` for exactly what each provider reports.

**Phase 3 = agents & launcher**: adapters for Claude Code, OpenCode and Codex CLI (`docs/AGENTS.md`), a compatibility engine
(compatible / limited / untested / incompatible, with reasons), and `cameleon launch` which starts the real agent with the
chosen provider and model — secrets only in the child environment, your own agent config never touched.
**Phase 4 = full desktop**: Agents page (detect, configure, inspect, launch, install guide), Profiles, model compatibility
per agent, complete Settings (startup, engine restart & logs, CLI status, security, cache, diagnostics), working quick actions.

## Quick start

```bash
# Node.js >= 20.6 required
npm install            # (ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install  → skip the Electron binary if you only want CLI/engine)
npm run build          # kit, shared, engine, cli
npm test               # 32 tests (kit, engine, real-subprocess CLI launch tests, desktop IPC allow-list & terminal builder)
node packages/cli/dist/bin.js init        # starts the engine in the background
node packages/cli/dist/bin.js provider configure
node packages/cli/dist/bin.js doctor
```

Optional global command: `npm link -w @cameleon/cli` → then just `cameleon …`.

Desktop (needs the Electron binary):

```bash
npm run build:desktop && npm run dev:desktop     # dev, hot reload
npm run build -w @cameleon/desktop && npx electron apps/desktop   # production build
```

## Download the desktop app

Installers for Windows, macOS and Linux are attached to [GitHub Releases](https://github.com/APOCAER23/CAMELEON-/releases).
The download page is published at [apocaer23.github.io/CAMELEON-](https://apocaer23.github.io/CAMELEON-/).
To build the installer for your current operating system locally, run:

```bash
npm ci
npm run package:desktop
```

The app installer includes its own Node.js runtime; a separate Node.js installation is not required to run it.
New public releases are built by GitHub Actions when a version tag (for example `v0.2.2`) is pushed.
Installers are currently unsigned, so Windows or macOS may display a security warning during installation.
To enable the download page, set the repository's GitHub Pages source to **GitHub Actions** once under **Settings → Pages**.

Environment variables: `CAMELEON_HOME` (relocate all data), `CAMELEON_PORT` (fixed engine port),
`CAMELEON_VAULT=file` (force the encrypted-file vault), `CAMELEON_NODE` (advanced override for the Node binary used by the desktop app).

## What is in the box

| Package | Role |
|---|---|
| `packages/kit` | **Reusable** building blocks (paths, migrations, vault, redaction, request guard, daemon discovery) — see `docs/REUSABLE-MODULES.md` |
| `packages/shared` | Zod schemas = the API contract, plus a typed engine client (transport-agnostic) |
| `packages/engine` | Fastify API on `127.0.0.1`, SQLite, provider registry, credential service |
| `packages/cli` | `cameleon` command (Commander + Inquirer) |
| `apps/desktop` | Electron + React + Vite + Tailwind, green/black/white design tokens, dark/light/system |

## CLI (Phase 1)

```
cameleon init | status | doctor
cameleon engine start|stop|status|logs
cameleon provider list [--category] [--configured] [--json]
cameleon provider credentials [id]
cameleon provider configure [id] [--label x] [--set baseUrl=…] [--key-stdin]
cameleon provider test [id]                       # live connection test of stored credentials
cameleon provider enable|disable|remove [id] [--label x]
cameleon models [search] [-p provider] [--tools --vision --reasoning --structured --streaming] [--all] [--json]
cameleon models sync [provider]                   # discover models (also runs after configure; --no-sync to skip)
cameleon models show <provider> <model>
cameleon models add|remove <provider> <model> [--context n --max-output n --tools yes|no …]
cameleon agent list [--refresh --json]            # detection: installed? version? path?  (install guides if missing)
cameleon launch <claude|opencode|codex> [-p provider -m model -l label --profile name --cwd dir --dry-run --force] [-- agent args]
cameleon launch                                   # uses the ACTIVE profile
cameleon agent inspect <agent> -p … -m …          # the exact plan, secrets masked
cameleon profile list|show|create|switch|delete   # e.g. profile create Coding --agent claude -p openrouter -m <model>
```
`provider configure` tests the connection **before** saving (`--no-test` to skip, `--force` to save a failing credential).
API keys are **never** accepted as arguments (`--set apiKey=…` is refused): use the hidden prompt or
`echo "$KEY" | cameleon provider configure openrouter --key-stdin`.

## Honest status

Verified in this build environment: engine, CLI, vault (file backend), SQLite, security checks (automated tests + real CLI run),
Electron main process compiles, renderer type-checks and builds.

**Not verified here** (no display / no Windows / no macOS / no Secret Service): launching the Electron window,
the OS keychain backend on real machines (code path is unit-tested with a fake keyring; on Linux without a Secret Service
the engine falls back to the encrypted vault and `cameleon doctor` tells you), Windows and macOS behaviour.
Provider endpoints come from public vendor docs and are verified by live tests in Phase 2.
Project profiles (`.cameleon/`), usage analytics, fallback, signed installers, configuration export/restore and app lock are Phases 5–6 and are not shown as working.

Phase 3/4 specifics: launching is verified with **fake agent executables** (real subprocesses: env, argv, temp-file lifecycle,
exit-code propagation, refusal cases). It has **not** been run against the real Claude Code / OpenCode / Codex binaries — their
environment variables / config keys / `-c` overrides follow their public documentation, but versions differ (notably Codex's
chat-vs-Responses wire API, which is why Codex + non-OpenAI providers is reported *untested*). `cameleon launch … --dry-run`
shows exactly what would be set. Terminal opening from the desktop (macOS/Windows/Linux emulators) is unit-tested as command
construction only. The Electron UI has still not been run on a display.

Phase 2 specifics: all provider traffic is verified against **local fake servers** in the test-suite (auth headers, pagination,
redirects, timeouts, refused connections, echoed keys, empty/offline catalogs). It has **not** been run against the real
OpenAI / Anthropic / OpenRouter / DeepSeek / Ollama / Gemini services (no API keys or network access here) — the first real
`cameleon provider configure` + `cameleon models sync` on your machine is the true acceptance test, and
`cameleon provider test` tells you precisely what failed. Response shapes follow each vendor's public docs; any field a
vendor does not return simply shows as unknown.
