import { ProviderDefinition, type ProviderField, type Protocol } from '@cameleon/shared';

const apiKey = (over: Partial<ProviderField> = {}): ProviderField => ({
  key: 'apiKey', label: 'API key', kind: 'secret', required: true, ...over,
});
const baseUrl = (placeholder: string, required = false, help = 'Leave empty to use the default endpoint'): ProviderField => ({
  key: 'baseUrl', label: 'Base URL', kind: 'url', required, placeholder, help,
});
const text = (key: string, label: string, help?: string): ProviderField => ({
  key, label, kind: 'text', required: false, ...(help ? { help } : {}),
});
const customHeadersField = (): ProviderField => ({
  key: 'customHeaders', label: 'Custom headers (JSON)', kind: 'secret', required: false, placeholder: '{"X-Org": "acme"}',
});

interface Spec {
  id: string; name: string; description: string; category: 'direct' | 'aggregator' | 'local' | 'custom';
  protocols: Protocol[]; endpoints?: Partial<Record<Protocol, string>>;
  auth: { type: 'bearer' | 'x-api-key' | 'query-key' | 'header' | 'none'; headerName?: string; extraHeaders?: Record<string, string> };
  fields: ProviderField[]; discovery: { kind: 'endpoint' | 'curated' | 'manual'; path?: string; protocol?: Protocol };
  keyPrefix?: string; docsUrl?: string;
}

/** Shorthand for the very common "OpenAI-compatible, Bearer token, GET /models" shape. */
const openaiCompat = (s: Omit<Spec, 'protocols' | 'auth' | 'discovery' | 'fields'> & {
  base: string;
  keyPrefix?: string;
  fields?: ProviderField[];
  discoveryKind?: 'endpoint' | 'curated' | 'manual';
}): Spec => {
  const { base, fields, discoveryKind = 'endpoint', ...rest } = s;
  return {
    ...rest,
    protocols: ['openai'],
    endpoints: { openai: base, ...(s.endpoints ?? {}) },
    auth: { type: 'bearer' },
    fields: fields ?? [apiKey(s.keyPrefix ? { placeholder: `${s.keyPrefix}…` } : {}), baseUrl(base)],
    discovery: discoveryKind === 'endpoint' ? { kind: 'endpoint', path: '/models', protocol: 'openai' } : { kind: discoveryKind },
  };
};

/** Shorthand for providers that natively expose both OpenAI-compatible and Anthropic Messages endpoints. */
const dualCompat = (s: Omit<Spec, 'protocols' | 'auth' | 'discovery' | 'fields' | 'endpoints'> & {
  openaiBase: string;
  anthropicBase: string;
  keyPrefix?: string;
  discoveryKind?: 'endpoint' | 'manual';
}): Spec => {
  const { openaiBase, anthropicBase, discoveryKind = 'endpoint', ...rest } = s;
  return {
    ...rest,
    protocols: ['openai', 'anthropic'],
    endpoints: { openai: openaiBase, anthropic: anthropicBase },
    auth: { type: 'bearer' },
    fields: [apiKey(s.keyPrefix ? { placeholder: `${s.keyPrefix}…` } : {}), baseUrl(openaiBase)],
    discovery: discoveryKind === 'endpoint' ? { kind: 'endpoint', path: '/models', protocol: 'openai' } : { kind: 'manual' },
  };
};

/** Shorthand for cloud or serverless deployments where the user supplies a resource-specific Base URL. */
const endpointRequired = (s: Omit<Spec, 'protocols' | 'auth' | 'discovery' | 'fields' | 'endpoints'> & {
  placeholder: string;
  help: string;
  keyRequired?: boolean;
  discoveryKind?: 'endpoint' | 'manual';
}): Spec => {
  const { placeholder, help, keyRequired = true, discoveryKind = 'endpoint', ...rest } = s;
  return {
    ...rest,
    protocols: ['openai'],
    auth: { type: 'bearer' },
    fields: [baseUrl(placeholder, true, help), apiKey({ required: keyRequired }), customHeadersField()],
    discovery: discoveryKind === 'endpoint' ? { kind: 'endpoint', path: '/models', protocol: 'openai' } : { kind: 'manual' },
  };
};

/** Shorthand for local OpenAI-compatible inference servers running on localhost without an API key. */
const localServer = (s: Omit<Spec, 'protocols' | 'auth' | 'discovery' | 'fields' | 'endpoints' | 'category'> & {
  base: string;
  help?: string;
}): Spec => {
  const { base, help, ...rest } = s;
  return {
    ...rest,
    category: 'local',
    protocols: ['openai'],
    endpoints: { openai: base },
    auth: { type: 'none' },
    fields: [baseUrl(base, false, help ?? `Local ${s.name} server URL`)],
    discovery: { kind: 'endpoint', path: '/models', protocol: 'openai' },
  };
};

/**
 * Endpoints below come from each vendor's public API documentation. They are *defaults*:
 * Phase 2 adapters verify them with live requests, and users can always override `baseUrl`.
 */
const specs: Spec[] = [
  /* ───────── Direct Model Labs & Cloud Providers ───────── */
  {
    id: 'anthropic', name: 'Anthropic', category: 'direct',
    description: 'Claude models through the native Messages API.',
    protocols: ['anthropic'], endpoints: { anthropic: 'https://api.anthropic.com' },
    auth: { type: 'x-api-key', extraHeaders: { 'anthropic-version': '2023-06-01' } },
    fields: [apiKey({ placeholder: 'sk-ant-…' }), baseUrl('https://api.anthropic.com')],
    discovery: { kind: 'endpoint', path: '/v1/models', protocol: 'anthropic' },
    keyPrefix: 'sk-ant-', docsUrl: 'https://docs.anthropic.com',
  },
  openaiCompat({
    id: 'openai', name: 'OpenAI', category: 'direct', description: 'GPT and reasoning models via the OpenAI API.',
    base: 'https://api.openai.com/v1', keyPrefix: 'sk-', docsUrl: 'https://platform.openai.com/docs',
    fields: [apiKey({ placeholder: 'sk-…' }), text('organization', 'Organization ID'), text('project', 'Project ID'), baseUrl('https://api.openai.com/v1')],
  }),
  {
    id: 'gemini', name: 'Google Gemini', category: 'direct',
    description: 'Gemini models via the Google AI Studio API.',
    protocols: ['gemini', 'openai'],
    endpoints: { gemini: 'https://generativelanguage.googleapis.com/v1beta', openai: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    auth: { type: 'header', headerName: 'x-goog-api-key' },
    fields: [apiKey({ placeholder: 'AIza…' }), baseUrl('https://generativelanguage.googleapis.com/v1beta')],
    discovery: { kind: 'endpoint', path: '/models', protocol: 'gemini' },
    keyPrefix: 'AIza', docsUrl: 'https://ai.google.dev/gemini-api/docs',
  },
  dualCompat({
    id: 'deepseek', name: 'DeepSeek', category: 'direct', description: 'DeepSeek chat and reasoning models.',
    openaiBase: 'https://api.deepseek.com', anthropicBase: 'https://api.deepseek.com/anthropic',
    keyPrefix: 'sk-', docsUrl: 'https://api-docs.deepseek.com',
  }),
  openaiCompat({ id: 'mistral', name: 'Mistral AI', category: 'direct', description: 'Mistral and Codestral models.', base: 'https://api.mistral.ai/v1', docsUrl: 'https://docs.mistral.ai' }),
  openaiCompat({ id: 'xai', name: 'xAI', category: 'direct', description: 'Grok models.', base: 'https://api.x.ai/v1', keyPrefix: 'xai-', docsUrl: 'https://docs.x.ai' }),
  {
    id: 'perplexity', name: 'Perplexity', category: 'direct',
    description: 'Search-grounded Sonar models.',
    protocols: ['openai'], endpoints: { openai: 'https://api.perplexity.ai' },
    auth: { type: 'bearer' },
    fields: [apiKey({ placeholder: 'pplx-…' }), baseUrl('https://api.perplexity.ai')],
    discovery: { kind: 'curated' }, keyPrefix: 'pplx-', docsUrl: 'https://docs.perplexity.ai',
  },
  openaiCompat({ id: 'cohere', name: 'Cohere', category: 'direct', description: 'Command models via Cohere OpenAI compatibility.', base: 'https://api.cohere.ai/compatibility/v1', docsUrl: 'https://docs.cohere.com' }),
  dualCompat({
    id: 'alibaba', name: 'Alibaba Cloud (Qwen)', category: 'direct', description: 'Qwen models via Alibaba Cloud Model Studio (international).',
    openaiBase: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', anthropicBase: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
    keyPrefix: 'sk-', docsUrl: 'https://www.alibabacloud.com/help/en/model-studio',
  }),
  dualCompat({
    id: 'alibaba-coding', name: 'Alibaba Coding Plan', category: 'direct', description: 'Dedicated Qwen Coding Plan endpoints for coding agents.',
    openaiBase: 'https://coding-intl.dashscope.aliyuncs.com/v1', anthropicBase: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic',
    keyPrefix: 'sk-sp-', docsUrl: 'https://www.alibabacloud.com/help/en/model-studio', discoveryKind: 'manual',
  }),
  dualCompat({
    id: 'zai', name: 'Zhipu AI (GLM / Z.ai)', category: 'direct', description: 'GLM frontier models with native OpenAI and Anthropic endpoints.',
    openaiBase: 'https://api.z.ai/api/paas/v4', anthropicBase: 'https://api.z.ai/api/anthropic',
    docsUrl: 'https://docs.z.ai',
  }),
  dualCompat({
    id: 'moonshot', name: 'Moonshot AI (Kimi)', category: 'direct', description: 'Kimi models via OpenAI and Anthropic-compatible endpoints.',
    openaiBase: 'https://api.moonshot.ai/v1', anthropicBase: 'https://api.moonshot.ai/anthropic',
    keyPrefix: 'sk-', docsUrl: 'https://platform.moonshot.ai/docs',
  }),
  dualCompat({
    id: 'minimax', name: 'MiniMax', category: 'direct', description: 'MiniMax text and coding models (OpenAI & Anthropic protocols).',
    openaiBase: 'https://api.minimax.io/v1', anthropicBase: 'https://api.minimax.io/anthropic',
    docsUrl: 'https://platform.minimax.io/docs', discoveryKind: 'manual',
  }),
  openaiCompat({ id: 'nvidia', name: 'NVIDIA NIM', category: 'direct', description: 'NVIDIA-hosted open and frontier models.', base: 'https://integrate.api.nvidia.com/v1', keyPrefix: 'nvapi-', docsUrl: 'https://build.nvidia.com' }),
  openaiCompat({ id: 'baidu', name: 'Baidu (ERNIE)', category: 'direct', description: 'ERNIE models through Baidu Qianfan v2 OpenAI API.', base: 'https://qianfan.baidubce.com/v2', keyPrefix: 'bce-v3/', docsUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP' }),
  openaiCompat({ id: 'tencent', name: 'Tencent Hunyuan', category: 'direct', description: 'Hunyuan models via Tencent Cloud OpenAI API.', base: 'https://api.hunyuan.cloud.tencent.com/v1', docsUrl: 'https://cloud.tencent.com/document/product/1729' }),
  openaiCompat({ id: 'ai21', name: 'AI21 Studio', category: 'direct', description: 'Jamba enterprise models via AI21 OpenAI compatibility.', base: 'https://api.ai21.com/studio/v1', docsUrl: 'https://docs.ai21.com' }),
  endpointRequired({
    id: 'azure-ai', name: 'Azure AI Foundry', category: 'direct',
    description: 'Azure OpenAI and Azure AI Foundry v1 resource endpoints.',
    placeholder: 'https://<resource>.openai.azure.com/openai/v1',
    help: 'Your Azure OpenAI or Azure AI Foundry v1 Base URL',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-foundry/',
  }),
  endpointRequired({
    id: 'bedrock', name: 'Amazon Bedrock', category: 'direct',
    description: 'AWS Bedrock Mantle OpenAI-compatible regional endpoints.',
    placeholder: 'https://bedrock-mantle.us-east-1.api.aws/v1',
    help: 'Regional Bedrock Mantle URL with a Bedrock API key',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/',
  }),
  endpointRequired({
    id: 'vertex-ai', name: 'Google Vertex AI', category: 'direct',
    description: 'Vertex AI OpenAI-compatible project & location endpoint.',
    placeholder: 'https://aiplatform.googleapis.com/v1/projects/<project>/locations/global/endpoints/openapi',
    help: 'Vertex AI OpenAPI endpoint URL (pass GCP OAuth token as API key)',
    docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library',
  }),
  endpointRequired({
    id: 'ibm-watsonx', name: 'IBM watsonx', category: 'direct',
    description: 'IBM Granite and third-party models on watsonx.ai.',
    placeholder: 'https://us-south.ml.cloud.ibm.com/ml/v1',
    help: 'Regional watsonx.ai endpoint or OpenAI gateway URL',
    discoveryKind: 'manual',
    docsUrl: 'https://www.ibm.com/docs/en/watsonx',
  }),

  /* ───────── Aggregators, Gateways & Fast Inference Clouds ───────── */
  {
    id: 'openrouter', name: 'OpenRouter', category: 'aggregator',
    description: 'One key for hundreds of models from many labs.',
    protocols: ['openai', 'anthropic'],
    endpoints: { openai: 'https://openrouter.ai/api/v1', anthropic: 'https://openrouter.ai/api' },
    auth: { type: 'bearer' },
    fields: [apiKey({ placeholder: 'sk-or-…' }), baseUrl('https://openrouter.ai/api/v1')],
    discovery: { kind: 'endpoint', path: '/models', protocol: 'openai' },
    keyPrefix: 'sk-or-', docsUrl: 'https://openrouter.ai/docs',
  },
  openaiCompat({ id: 'groq', name: 'Groq', category: 'aggregator', description: 'Very fast LPU inference on open models.', base: 'https://api.groq.com/openai/v1', keyPrefix: 'gsk_', docsUrl: 'https://console.groq.com/docs' }),
  openaiCompat({ id: 'together', name: 'Together AI', category: 'aggregator', description: 'Open-source models hosted by Together.', base: 'https://api.together.xyz/v1', docsUrl: 'https://docs.together.ai' }),
  openaiCompat({ id: 'fireworks', name: 'Fireworks AI', category: 'aggregator', description: 'Fast open-model inference platform.', base: 'https://api.fireworks.ai/inference/v1', docsUrl: 'https://docs.fireworks.ai' }),
  openaiCompat({ id: 'cerebras', name: 'Cerebras', category: 'aggregator', description: 'Wafer-scale inference for open models.', base: 'https://api.cerebras.ai/v1', docsUrl: 'https://inference-docs.cerebras.ai' }),
  openaiCompat({ id: 'deepinfra', name: 'DeepInfra', category: 'aggregator', description: 'Fast serverless inference for open-weight models.', base: 'https://api.deepinfra.com/v1/openai', docsUrl: 'https://deepinfra.com/docs' }),
  openaiCompat({ id: 'huggingface', name: 'Hugging Face', category: 'aggregator', description: 'Unified Inference Providers router on Hugging Face.', base: 'https://router.huggingface.co/v1', keyPrefix: 'hf_', docsUrl: 'https://huggingface.co/docs/inference-providers' }),
  openaiCompat({ id: 'novita', name: 'Novita AI', category: 'aggregator', description: 'Serverless LLM inference cloud.', base: 'https://api.novita.ai/v3/openai', docsUrl: 'https://novita.ai/docs' }),
  openaiCompat({ id: 'siliconflow', name: 'SiliconFlow', category: 'aggregator', description: 'High-throughput open-model inference (international).', base: 'https://api.siliconflow.com/v1', keyPrefix: 'sk-', docsUrl: 'https://docs.siliconflow.com' }),
  openaiCompat({ id: 'hyperbolic', name: 'Hyperbolic', category: 'aggregator', description: 'Low-cost open-weight model inference API.', base: 'https://api.hyperbolic.xyz/v1', docsUrl: 'https://docs.hyperbolic.xyz' }),
  openaiCompat({ id: 'nebius', name: 'Nebius AI Studio', category: 'aggregator', description: 'Nebius Token Factory open-model API.', base: 'https://api.tokenfactory.nebius.com/v1', docsUrl: 'https://docs.nebius.com' }),
  openaiCompat({ id: 'sambanova', name: 'SambaNova', category: 'aggregator', description: 'Ultra-fast RDU inference on SambaNova Cloud.', base: 'https://api.sambanova.ai/v1', docsUrl: 'https://docs.sambanova.ai' }),
  openaiCompat({ id: 'featherless', name: 'Featherless AI', category: 'aggregator', description: 'Serverless inference for thousands of Hugging Face models.', base: 'https://api.featherless.ai/v1', docsUrl: 'https://featherless.ai/docs' }),
  openaiCompat({ id: 'chutes', name: 'Chutes AI', category: 'aggregator', description: 'Decentralized serverless AI inference API.', base: 'https://llm.chutes.ai/v1', docsUrl: 'https://chutes.ai/docs' }),
  openaiCompat({ id: 'baseten', name: 'Baseten', category: 'aggregator', description: 'Baseten Model APIs serverless inference.', base: 'https://inference.baseten.co/v1', docsUrl: 'https://docs.baseten.co' }),
  openaiCompat({ id: 'friendli', name: 'FriendliAI', category: 'aggregator', description: 'Friendli Serverless open-model inference.', base: 'https://api.friendli.ai/serverless/v1', docsUrl: 'https://friendli.ai/docs' }),
  openaiCompat({ id: 'ovhcloud', name: 'OVHcloud AI Endpoints', category: 'aggregator', description: 'European sovereign serverless LLM endpoints by OVHcloud.', base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', docsUrl: 'https://endpoints.ai.cloud.ovh.net' }),
  openaiCompat({ id: 'digitalocean', name: 'DigitalOcean Gradient AI', category: 'aggregator', description: 'DigitalOcean serverless model inference.', base: 'https://inference.do-ai.run/v1', docsUrl: 'https://docs.digitalocean.com/products/gradient-platform/' }),
  openaiCompat({ id: 'github-models', name: 'GitHub Models', category: 'aggregator', description: 'Hosted frontier models via your GitHub PAT.', base: 'https://models.github.ai/inference', keyPrefix: 'github_pat_', docsUrl: 'https://docs.github.com/en/github-models' }),
  openaiCompat({ id: 'vercel', name: 'Vercel AI Gateway', category: 'aggregator', description: 'Unified multi-provider LLM gateway by Vercel.', base: 'https://ai-gateway.vercel.sh/v1', docsUrl: 'https://vercel.com/docs/ai-gateway' }),
  openaiCompat({
    id: 'portkey', name: 'Portkey', category: 'aggregator', description: 'Production AI gateway with routing and virtual keys.',
    base: 'https://api.portkey.ai/v1', discoveryKind: 'manual', docsUrl: 'https://portkey.ai/docs',
    fields: [apiKey(), baseUrl('https://api.portkey.ai/v1'), customHeadersField()],
  }),
  openaiCompat({ id: 'edenai', name: 'Eden AI', category: 'aggregator', description: 'Multi-provider AI aggregator via Eden AI v3.', base: 'https://api.edenai.run/v3', docsUrl: 'https://docs.edenai.co' }),
  dualCompat({
    id: 'opencode-zen', name: 'OpenCode Zen', category: 'aggregator', description: 'Curated coding-agent model gateway by OpenCode.',
    openaiBase: 'https://opencode.ai/zen/v1', anthropicBase: 'https://opencode.ai/zen',
    docsUrl: 'https://opencode.ai/docs/zen/',
  }),
  openaiCompat({ id: 'zenmux', name: 'ZenMux', category: 'aggregator', description: 'Multi-model routing gateway for coding and chat.', base: 'https://zenmux.ai/api/v1', docsUrl: 'https://zenmux.ai' }),
  openaiCompat({ id: 'aimlapi', name: 'AI/ML API', category: 'aggregator', description: '200+ AI models through a single OpenAI-compatible key.', base: 'https://api.aimlapi.com/v1', docsUrl: 'https://docs.aimlapi.com' }),
  openaiCompat({ id: 'requesty', name: 'Requesty', category: 'aggregator', description: 'Smart LLM router with fallback and cost controls.', base: 'https://router.requesty.ai/v1', docsUrl: 'https://docs.requesty.ai' }),
  openaiCompat({ id: 'nanogpt', name: 'NanoGPT', category: 'aggregator', description: 'Pay-per-prompt unified model aggregator.', base: 'https://api.nano-gpt.com/api/v1', docsUrl: 'https://nano-gpt.com/api' }),
  openaiCompat({ id: 'venice', name: 'Venice AI', category: 'aggregator', description: 'Privacy-focused uncensored OpenAI-compatible API.', base: 'https://api.venice.ai/api/v1', docsUrl: 'https://docs.venice.ai' }),
  openaiCompat({ id: 'aihubmix', name: 'AIHubMix', category: 'aggregator', description: 'Unified multi-lab model relay API.', base: 'https://aihubmix.com/v1', keyPrefix: 'sk-', docsUrl: 'https://doc.aihubmix.com' }),
  openaiCompat({ id: '302ai', name: '302.AI', category: 'aggregator', description: 'Pay-as-you-go multi-model AI gateway.', base: 'https://api.302.ai/v1', keyPrefix: 'sk-', docsUrl: 'https://302.ai' }),
  openaiCompat({ id: 'kilo', name: 'Kilo Gateway', category: 'aggregator', description: 'Kilo AI unified coding model gateway.', base: 'https://api.kilo.ai/api/gateway', docsUrl: 'https://kilo.ai/docs' }),
  openaiCompat({ id: 'poe', name: 'Poe', category: 'aggregator', description: 'Query frontier models and bots via Poe OpenAI API.', base: 'https://api.poe.com/v1', docsUrl: 'https://developer.poe.com' }),
  endpointRequired({
    id: 'cloudflare', name: 'Cloudflare Workers AI', category: 'aggregator',
    description: 'Edge LLM inference scoped to your Cloudflare Account ID.',
    placeholder: 'https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1',
    help: 'Replace <account_id> with your Cloudflare Account ID',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/',
  }),
  endpointRequired({
    id: 'lepton', name: 'Lepton AI', category: 'aggregator',
    description: 'Serverless and dedicated model endpoints on Lepton AI.',
    placeholder: 'https://<endpoint>.lepton.run/v1',
    help: 'Your Lepton deployment endpoint URL',
    docsUrl: 'https://www.lepton.ai/docs',
  }),
  endpointRequired({
    id: 'runpod', name: 'RunPod', category: 'aggregator',
    description: 'RunPod Serverless vLLM OpenAI-compatible endpoints.',
    placeholder: 'https://api.runpod.ai/v2/<endpoint_id>/openai/v1',
    help: 'Replace <endpoint_id> with your RunPod serverless endpoint ID',
    docsUrl: 'https://docs.runpod.io/serverless/vllm/openai-compatibility',
  }),
  endpointRequired({
    id: 'modal', name: 'Modal', category: 'aggregator',
    description: 'Custom OpenAI-compatible vLLM / SGLang endpoints deployed on Modal.',
    placeholder: 'https://<workspace>--<app>.modal.run/v1',
    help: 'Your Modal web endpoint Base URL',
    keyRequired: false,
    docsUrl: 'https://modal.com/docs/examples/vllm_inference',
  }),

  /* ───────── Local Inference Servers ───────── */
  {
    id: 'ollama', name: 'Ollama', category: 'local',
    description: 'Run open models locally. No key required.',
    protocols: ['ollama', 'openai', 'anthropic'],
    endpoints: { ollama: 'http://localhost:11434', openai: 'http://localhost:11434/v1', anthropic: 'http://localhost:11434' },
    auth: { type: 'none' },
    fields: [baseUrl('http://localhost:11434', false, 'Host running Ollama (default: this machine)')],
    discovery: { kind: 'endpoint', path: '/api/tags', protocol: 'ollama' },
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
  },
  {
    id: 'lmstudio', name: 'LM Studio', category: 'local',
    description: 'Local models through the LM Studio server.',
    protocols: ['openai'], endpoints: { openai: 'http://localhost:1234/v1' },
    auth: { type: 'none' },
    fields: [baseUrl('http://localhost:1234/v1', false, 'Start the LM Studio local server first')],
    discovery: { kind: 'endpoint', path: '/models', protocol: 'openai' },
    docsUrl: 'https://lmstudio.ai/docs',
  },
  localServer({ id: 'localai', name: 'LocalAI', description: 'Self-hosted drop-in OpenAI-compatible local runtime.', base: 'http://localhost:8080/v1', docsUrl: 'https://localai.io' }),
  localServer({ id: 'llamacpp', name: 'llama.cpp', description: 'High-speed local C/C++ GGUF inference via llama-server.', base: 'http://localhost:8080/v1', docsUrl: 'https://github.com/ggml-org/llama.cpp' }),
  localServer({ id: 'vllm', name: 'vLLM', description: 'High-throughput OpenAI-compatible serving engine.', base: 'http://localhost:8000/v1', docsUrl: 'https://docs.vllm.ai' }),
  localServer({ id: 'tgi', name: 'Hugging Face TGI', description: 'Text Generation Inference OpenAI-compatible local server.', base: 'http://localhost:8080/v1', docsUrl: 'https://huggingface.co/docs/text-generation-inference' }),
  localServer({ id: 'jan', name: 'Jan', description: 'Offline open-source desktop AI server on port 1337.', base: 'http://localhost:1337/v1', docsUrl: 'https://jan.ai/docs' }),
  localServer({ id: 'gpt4all', name: 'GPT4All', description: 'Local CPU/GPU privacy-first model API server.', base: 'http://localhost:4891/v1', docsUrl: 'https://docs.gpt4all.io' }),
  localServer({ id: 'mlx', name: 'MLX', description: 'Apple Silicon local inference via mlx_lm.server.', base: 'http://localhost:8080/v1', docsUrl: 'https://github.com/ml-explore/mlx-lm' }),

  /* ───────── Custom Gateways ───────── */
  {
    id: 'custom-openai', name: 'Custom OpenAI-compatible', category: 'custom',
    description: 'Any server exposing the OpenAI chat-completions API.',
    protocols: ['openai'], auth: { type: 'bearer' },
    fields: [
      baseUrl('https://my-gateway.example.com/v1', true, 'Base URL including the version path'),
      apiKey({ required: false }),
      customHeadersField(),
    ],
    discovery: { kind: 'endpoint', path: '/models', protocol: 'openai' },
  },
  {
    id: 'custom-anthropic', name: 'Custom Anthropic-compatible', category: 'custom',
    description: 'Any server exposing the Anthropic Messages API.',
    protocols: ['anthropic'], auth: { type: 'x-api-key', extraHeaders: { 'anthropic-version': '2023-06-01' } },
    fields: [
      baseUrl('https://my-gateway.example.com', true, 'Base URL of the Messages API'),
      apiKey({ required: false }),
      customHeadersField(),
    ],
    discovery: { kind: 'manual' },
  },
];

/** Parsed through Zod at import time: a malformed built-in definition fails fast. */
export const BUILTIN_PROVIDERS: ProviderDefinition[] = specs.map((s) => ProviderDefinition.parse({ endpoints: {}, ...s }));
