# Agent integrations (Phase 3)

An agent = one file in `packages/engine/src/agents/` exporting an `AgentSpec`, listed in `agents/index.ts`.
The compatibility engine, launcher, CLI and desktop pick it up automatically.

**Principles**
- Only each agent's **documented** configuration mechanism is used. Your own config files (`~/.claude`, `opencode.json`, `~/.codex/config.toml`) are **never modified**, so there is nothing to back up or restore — conflicting variables are only removed from the *launched process*.
- Secrets travel **only in the child's environment** (never argv, never files). A runtime check aborts the launch if a secret would appear anywhere else.
- Processes are started with an argv array (execa/cross-spawn), never through a shell string.
- CAMELEON never installs an agent: it shows the install command and waits.
- Detection finds the executable on `PATH` (+ common user bin dirs) and reads `--version`; the engine hands the CLI an absolute path.

| | Claude Code | OpenCode | Codex CLI |
|---|---|---|---|
| Binary | `claude` | `opencode` | `codex` |
| Protocol(s) | Anthropic Messages | OpenAI-compatible, then Anthropic | OpenAI-compatible |
| Mechanism | Environment variables | Temp JSON via `OPENCODE_CONFIG` (merged over your config) | `-m` and `-c model_providers.cameleon={…}` per invocation |
| Key passing | `ANTHROPIC_API_KEY` (x-api-key providers) or `ANTHROPIC_AUTH_TOKEN` (Bearer providers) | `CAMELEON_API_KEY`, referenced as `{env:CAMELEON_API_KEY}` | `OPENAI_API_KEY` (OpenAI) or `CAMELEON_API_KEY` via `env_key` |
| Model selection | `ANTHROPIC_MODEL` + Opus/Sonnet/Haiku/sub-agent aliases pinned to it (third-party endpoints) | `"model": "cameleon-<provider>/<model>"` | `-m <model>` |
| Cleans up | `ANTHROPIC_*`, `CLAUDE_CODE_USE_BEDROCK/VERTEX` removed from the child env | `OPENCODE_CONFIG[_CONTENT]` | `OPENAI_API_KEY/BASE_URL` |
| Restore | none needed | temp dir deleted at exit | none needed |
| First-party providers | `anthropic` | — | `openai` |

## Compatibility engine (`compat/engine.ts`)
Four statuses: **compatible · limited · untested · incompatible**, with explained reasons (`blocker` / `limitation` / `info`).
- *Blockers → incompatible*: no shared protocol (e.g. Claude Code on an OpenAI-only provider), missing/disabled credential or key, non-chat model (embedding/image/audio/moderation), tool calling or streaming reported **unsupported**.
- *Untested*: tool calling not reported by the provider (unless vendor-supported pair), or an agent-specific unverifiable caveat (Codex + non-OpenAI providers: wire-API support depends on the installed Codex version).
- *Limited*: works with caveats — third-party Anthropic-compatible layers for Claude Code (caching/web search/extended thinking may differ); context window below the advisory 32k.
- *Compatible*: every requirement verified or vendor-supported.
"Unknown" is never read as "supported". `--force` can launch an incompatible combination, and the plan still says so.

## Launcher (`cameleon launch`)
1. detect agent (+ OS support) → 2. resolve profile / flags / interactive pick (incompatible models hidden) → 3. engine builds the plan (`/v1/launch/prepare`, records the session) → 4. temp files created `0600` in a private dir → 5. real agent started attached to your terminal, `unset` + `set` env applied, SIGTERM/SIGHUP forwarded → 6. temp files removed, session closed with its real exit code (`cameleon`'s own exit code = the agent's).
`--dry-run` / `agent inspect` print the same plan with secrets masked and start nothing.
`/v1/launch/prepare` is the **only** route that returns decrypted secrets; it is token-protected, loopback-only, and absent from the desktop IPC allow-list.

## Desktop launching
Agents are interactive TUIs, so the desktop opens **your system terminal** running `cameleon launch …` (you pick the working folder first). Identifiers are regex-validated and passed as separate argv entries (Linux), quoted (macOS) or as an argv array (Windows). If no terminal can be opened, the exact command is shown to copy.
