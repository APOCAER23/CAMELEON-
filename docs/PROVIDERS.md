# Provider integrations (Phase 2)

Every integration lives in `packages/engine/src/adapters/`. An adapter has two methods:
`test()` (cheap, authenticated, non-billable request — never throws) and `discover()` (model catalog).
Providers added through `providers.d/*.json` or the UI get the generic adapter of their declared protocol — no code needed.

**Rules applied everywhere**
- Redirects are never followed (credentials cannot be forwarded to another host).
- 10 s timeout (override: `CAMELEON_HTTP_TIMEOUT_MS`), 8 MiB response cap.
- Error text from providers is scrubbed (known secret values + key-shaped strings) and truncated before it is shown or logged.
- A capability / limit / price is stored only when the provider API reports it; otherwise `unknown` / `null`.
- A failed or empty sync never erases the cached catalog. Manual models survive every sync.
- Errors are classified: `auth`, `network`, `timeout`, `rate_limited`, `server`, `not_found`, `redirect`, `unexpected`.

| Provider | Adapter | Auth | Connection test | Discovery | Reported by the API → stored |
|---|---|---|---|---|---|
| **OpenRouter** | `OpenRouterAdapter` | Bearer | `GET /auth/key` (its `/models` is public and would not validate the key) | `GET /models` | context, max output, price (USD/token → per 1M; `-1` → null), modalities → vision/kind, `supported_parameters` → tools / structured / reasoning; streaming = supported (documented platform-wide) |
| **OpenAI** | `OpenAICompatAdapter` | Bearer (+ `OpenAI-Organization`, `OpenAI-Project`) | `GET /models` | `GET /models` | id only → everything else `unknown`; embedding/audio/image/moderation ids classified by name |
| **Anthropic** | `AnthropicAdapter` | `x-api-key` + `anthropic-version: 2023-06-01` | `GET /v1/models?limit=1` | `GET /v1/models` (paginated via `after_id`) | `display_name`; `max_input_tokens`, `max_tokens`, `capabilities.{image_input, structured_outputs, thinking}` **when present**; streaming = supported; tool calling stays `unknown` unless reported; no prices |
| **DeepSeek** | `OpenAICompatAdapter` | Bearer | `GET /models` | `GET /models` | id only |
| **Ollama** | `OllamaAdapter` | none | `GET /api/version` | `GET /api/tags` + `POST /api/show` per model (4 in parallel, failures tolerated) | family · size · quantisation, `capabilities` (tools / vision / thinking / embedding), `*.context_length`; older Ollama versions report no capabilities → `unknown` |
| Google Gemini | `GeminiAdapter` | `x-goog-api-key` | `GET /models?pageSize=1` | `GET /models` (paginated) | `inputTokenLimit`, `outputTokenLimit`, methods → kind, `thinking` flag |
| Groq, Mistral, Together, Fireworks, Cerebras, xAI, LM Studio, custom OpenAI | `OpenAICompatAdapter` | Bearer / none | `GET /models` | `GET /models` | id, plus context length / Mistral `capabilities` when the vendor adds them |
| Perplexity | `CuratedAdapter` | Bearer | **unsupported** (no free endpoint — never reported as "connected") | curated list (marked `curated`) | ids only |
| Custom Anthropic | `AnthropicAdapter` | `x-api-key` | `GET /v1/models` (best effort) | manual registration | — |

Base-URL overrides apply to the provider's primary protocol (and to every protocol of custom providers). For Ollama the override is the server root; the OpenAI-compatible `/v1` URL is derived from it.
Default endpoints come from the vendors' public documentation; adding a provider or correcting an endpoint is a data change.
