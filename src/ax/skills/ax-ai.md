---
name: ax-ai
description: This skill helps an LLM generate correct AI provider setup and configuration code using @ax-llm/ax. Use when the user asks about ai(), providers, models, presets, embeddings, batch audio with ai.transcribe() or ai.speak(), extended thinking, context caching, or mentions OpenAI/Anthropic/Google/Azure/DeepSeek/Mistral/Cohere/Reka/Grok with @ax-llm/ax.
version: "__VERSION__"
---

# AI Provider Codegen Rules (@ax-llm/ax)

Use this skill to generate AI provider setup, configuration, and chat code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Quick Setup

```typescript
import { ai } from '@ax-llm/ax';

const openai = ai({ name: 'openai', apiKey: 'sk-...' });
const claude = ai({ name: 'anthropic', apiKey: 'sk-ant-...' });
const gemini = ai({ name: 'google-gemini', apiKey: 'AIza...' });
const azure = ai({ name: 'azure-openai', apiKey: 'your-key', resourceName: 'your-resource', deploymentName: 'gpt-5-4-mini' });
const deepseek = ai({ name: 'deepseek', apiKey: 'sk-...' });
const mistral = ai({ name: 'mistral', apiKey: 'your-key' });
const cohere = ai({ name: 'cohere', apiKey: 'your-key' });
const custom = ai({
  name: 'openai',
  apiKey: process.env.PROVIDER_API_KEY,
  apiURL: 'https://example.com/v1',
  config: { model: 'provider/model-name' },
});
const reka = ai({ name: 'reka', apiKey: 'your-key' });
const grok = ai({ name: 'grok', apiKey: 'your-key' });
const compatible = ai({ name: 'openai', apiKey: 'key', apiURL: 'https://api.example.com/v1', config: { model: 'provider/model' } });
```

<!-- axir-nonportable:start webllm -->
WebLLM is browser-only and requires a host-created WebLLM engine. The host
loads or reloads models with WebLLM APIs such as `CreateMLCEngine(...)`; Ax
only forwards chat requests to that loaded engine. Do not present WebLLM as a
portable AxIR provider or a server-side default.

```typescript
import { ai, AxAIWebLLMModel } from '@ax-llm/ax';

const engine = await CreateMLCEngine(AxAIWebLLMModel.Llama32_3B_Instruct);
const llm = ai({
  name: 'webllm',
  engine,
  config: {
    model: AxAIWebLLMModel.Llama32_3B_Instruct,
    stream: false,
    supportsFunctions: false,
  },
});
```
<!-- axir-nonportable:end webllm -->

## Model Presets

```typescript
import { ai, AxAIGoogleGeminiModel } from '@ax-llm/ax';

const gemini = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: 'simple' },
  models: [
    { key: 'tiny', model: AxAIGoogleGeminiModel.Gemini31FlashLite, description: 'Fast + cheap', config: { maxTokens: 1024, temperature: 0.3 } },
    { key: 'simple', model: AxAIGoogleGeminiModel.Gemini35Flash, description: 'Balanced', config: { temperature: 0.6 } },
  ],
});

await gemini.chat({ model: 'tiny', chatPrompt: [{ role: 'user', content: 'Hi' }] });
```

## Model Catalog

```typescript
import { axGetSupportedAIModels } from '@ax-llm/ax';

const providers = axGetSupportedAIModels();
const openai = providers.find((provider) => provider.name === 'openai');
console.log(openai?.models[0]?.promptTokenCostPer1M);

const textProviders = axGetSupportedAIModels({ type: 'text' });
const embeddingProviders = axGetSupportedAIModels({ type: 'embeddings' });
```

Use `axGetSupportedAIModels()` to build provider/model selectors before creating an `ai(...)` instance. It returns bundled static metadata: provider names, display names, default models, raw `AxModelInfo` pricing/details, model type (`'text'`, `'embeddings'`, `'code'`, or `'audio'`), and normalized capability flags for thinking, thoughts, structured outputs, audio, temperature, and top-p support. Provider groups and models are sorted cheapest to most expensive based on bundled input + output token pricing; unpriced models sort last.

Filter with `{ type: 'all' | 'text' | 'embeddings' | 'code' | 'audio' }` or an array of those values. The `'text'` filter includes code-capable models; use `'code'` to show only code-first models.

Dynamic providers such as Azure OpenAI deployments are marked with `isDynamic: true` and may have an empty or static-limited model list.

## Chat

```typescript
const res = await llm.chat({
  chatPrompt: [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Write a haiku about the ocean.' },
  ],
});
console.log(res.results[0]?.content);
```

## Batch Audio

Use `ai.transcribe(...)` for batch speech-to-text and `ai.speak(...)` for batch text-to-speech. These are separate from conversational `.chat()` audio config.

```typescript
const transcript = await llm.transcribe({
  audio: { data: base64Wav, format: 'wav' },
  model: 'gpt-4o-mini-transcribe',
  language: 'en',
});

const speech = await llm.speak({
  text: transcript.text,
  model: 'gpt-4o-mini-tts',
  voice: 'alloy',
  format: 'mp3',
});

console.log(transcript.text);
console.log(speech.data);
```

Providers without the requested audio endpoint throw `AxMediaNotSupportedError`. Use `speech` forward options for signature audio artifacts and `modelConfig.audio` for conversational chat audio.

## Common Options

- `stream` (boolean): enable SSE; true by default
- `thinkingTokenBudget`: `'minimal'` | `'low'` | `'medium'` | `'high'` | `'highest'` | `'none'`
- `showThoughts`: include thoughts in output
- `functionCallMode`: `'auto'` | `'native'` | `'prompt'`
- `debug`, `logger`, `tracer`, `rateLimiter`, `timeout`

## Global Runtime Defaults

Use `axGlobals` when the app wants one live default for AI requests, generator runs, flows, or metrics:

```typescript
import { ai, axGlobals, axCreateDefaultColorLogger } from '@ax-llm/ax';
import { trace } from '@opentelemetry/api';

axGlobals.tracer = trace.getTracer('my-app');
axGlobals.debug = true;
axGlobals.logger = axCreateDefaultColorLogger();
axGlobals.customLabels = { service: 'api' };

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });
```

Rules:

- `axGlobals.tracer`, `meter`, `logger`, `debug`, `abortSignal`, and `customLabels` are live runtime defaults; future calls read the current value even if the AI instance already exists.
- Precedence is: per-call options, then explicit AI/service options, then current `axGlobals`, then built-in defaults.
- `customLabels` merge from globals to service to call options; later sources override earlier keys.
- `abortSignal` values are merged, so either a global shutdown signal or a local request signal can cancel the request.

## DeepSeek Notes

```typescript
import { ai, AxAIDeepSeekModel } from '@ax-llm/ax';

const deepseek = ai({
  name: 'deepseek',
  apiKey: process.env.DEEPSEEK_APIKEY!,
  config: { model: AxAIDeepSeekModel.DeepSeekV4Flash },
});
```

DeepSeek's current API models are `deepseek-v4-flash` and `deepseek-v4-pro`.
The deprecated `deepseek-chat` and `deepseek-reasoner` aliases are retained for
compatibility until DeepSeek removes them on 2026-07-24.

DeepSeek V4 supports thinking mode. Ax sends `thinking: { type: "disabled" }`
by default to preserve non-thinking behavior, and enables it when
`thinkingTokenBudget` is set. Ax maps lower budget levels to DeepSeek's `high`
effort and maps `highest` to `max`. DeepSeek V4 thinking models support tools,
but reject the `tool_choice` request parameter, so Ax omits forced/auto tool
choice for `deepseek-v4-pro`, `deepseek-v4-flash`, and `deepseek-reasoner`
while still sending tool definitions.

## Extended Thinking

```typescript
import { ai, AxAIAnthropicModel } from '@ax-llm/ax';

const claude = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: { model: AxAIAnthropicModel.Claude48Opus },
});

const res = await claude.chat(
  { chatPrompt: [{ role: 'user', content: 'Solve step by step...' }] },
  { thinkingTokenBudget: 'medium', showThoughts: true },
);
console.log(res.results[0]?.thought);
console.log(res.results[0]?.content);
```

### Budget Levels

| Level | Anthropic (tokens) | Gemini (tokens) |
|---|---|---|
| `'none'` | disabled | minimal |
| `'minimal'` | 1,024 | 200 |
| `'low'` | 5,000 | 800 |
| `'medium'` | 10,000 | 5,000 |
| `'high'` | 20,000 | 10,000 |
| `'highest'` | 32,000 | 24,500 |

### Anthropic Model-Specific Behavior

- Opus 4.8 and 4.7: adaptive thinking, effort levels including `'xhigh'`,
  no manual `budget_tokens`, and no `temperature` / `topP` / `topK`.
- Opus 4.6: adaptive thinking, effort levels
- Opus 4.5: budget_tokens + effort levels (capped at `'high'`)
- Other thinking models: budget tokens only

Anthropic `modelConfig.effort` can be set directly on a request. Fast mode and
task budgets are Anthropic-only opt-ins; `taskBudget.total` must be at least
20,000 tokens.

```typescript
const res = await claude.chat({
  chatPrompt: [{ role: 'user', content: 'Review this migration plan.' }],
  modelConfig: {
    effort: 'xhigh',
    speed: 'fast',
    taskBudget: { type: 'tokens', total: 64_000 },
  },
});
```

### Custom Thinking Levels

```typescript
const claude = ai({
  name: 'anthropic',
  apiKey: '...',
  config: {
    model: AxAIAnthropicModel.Claude48Opus,
    thinkingTokenBudgetLevels: {
      minimal: 2048,
      low: 8000,
      medium: 16000,
      high: 25000,
      highest: 40000,
    },
    effortLevelMapping: {
      minimal: 'low',
      low: 'medium',
      medium: 'high',
      high: 'high',
      highest: 'max',
    },
  },
});
```

## Embeddings

```typescript
const { embeddings } = await llm.embed({
  texts: ['hello', 'world'],
  embedModel: 'text-embedding-005',
});
```

## Context Caching

```typescript
const result = await gen.forward(llm, { code, language }, {
  mem,
  sessionId: 'code-review-session',
  contextCache: {
    ttlSeconds: 3600,
    cacheBreakpoint: 'after-examples',
  },
});
```

Breakpoint values: `'system'` | `'after-functions'` | `'after-examples'`

Provider behavior:

- Google Gemini: explicit caching with cache resource ID, auto TTL refresh
- Anthropic: implicit via `cache_control` markers

### External Registry (serverless)

```typescript
const registry: AxContextCacheRegistry = {
  get: async (key) => { /* redis.get */ },
  set: async (key, entry) => { /* redis.set */ },
};
```

## AWS Bedrock

```typescript
import { AxAIBedrock, AxAIBedrockModel } from '@ax-llm/ax-ai-aws-bedrock';

const bedrock = new AxAIBedrock({
  region: 'us-east-2',
  fallbackRegions: ['us-west-2'],
  config: { model: AxAIBedrockModel.ClaudeOpus45 },
});
```

## Vercel AI SDK Integration

```typescript
import { generateText } from 'ai';
import { ai } from '@ax-llm/ax';
import { AxAIProvider } from '@ax-llm/ax-ai-sdk-provider';

const axAI = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY ?? '',
});
const model = new AxAIProvider(axAI);

const result = await generateText({
  model,
  prompt: 'Hello!',
});
```

## MCP + AxJSRuntime

```typescript
import { AxMCPClient } from '@ax-llm/ax';
import { axCreateMCPStdioTransport } from '@ax-llm/ax-tools';

const transport = axCreateMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@anthropic/mcp-server-filesystem'],
});
const client = new AxMCPClient(transport);
```

## Critical Rules

- Use `ai()` factory for all providers.
- Provider names: `'openai'`, `'openai-responses'`, `'anthropic'`, `'google-gemini'`, `'azure-openai'`, `'mistral'`, `'cohere'`, `'deepseek'`, `'reka'`, `'grok'`
- Thinking constraints on Anthropic: Opus 4.8/4.7 omit `temperature`, `topP`,
  and `topK`; older thinking models ignore `temperature` and `topK`, with
  `topP` only sent if >= 0.95.
- Bedrock uses `new AxAIBedrock()`, not `ai()`.
- Vercel AI SDK uses `AxAIProvider` wrapper.

## Examples

Fetch these for full working code:

- [Embeddings](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/embed.ts) — embedding generation
- [Anthropic Thinking](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/anthropic-thinking-function.ts) — extended thinking with functions
- [Anthropic Thinking Separation](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/anthropic-thinking-separation.ts) — thinking separation
- [Anthropic Web Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/anthropic-web-search.ts) — Anthropic web search
- [OpenAI Web Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/openai-web-search.ts) — OpenAI web search
- [OpenAI Responses](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/openai-responses.ts) — OpenAI responses API
- [o3 Reasoning](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/reasoning-o3-example.ts) — o3 reasoning
- [Gemini Context Cache](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/gemini-context-cache.ts) — Gemini context caching
- [Gemini Files](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/gemini-file-support.ts) — Gemini file handling
- [Grok Live Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/grok-live-search.ts) — Grok live search
- [OpenAI-Compatible](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/openai-compatible.ts) — custom OpenAI-compatible base URL
- [Vertex AI Auth](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/vertex-auth-example.ts) — Vertex AI authentication
- [MCP Stdio](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-memory.ts) — MCP stdio transport
- [MCP HTTP](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-pipedream.ts) — MCP HTTP transport
- [Telemetry](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/telemetry.ts) — OpenTelemetry tracing
- [Multi-Modal](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/multi-modal.ts) — image handling

## Do Not Generate

- Do not use `new AxAIOpenAI(...)` or similar class constructors for standard providers; use `ai()`.
- Do not hardcode provider class names when `ai({ name: ... })` covers the provider.
- Do not mix `thinkingTokenBudget` with explicit `temperature` on Anthropic thinking models.
- Do not use `ai()` for AWS Bedrock; use `new AxAIBedrock()`.
- Do not omit `resourceName` and `deploymentName` for Azure OpenAI.
