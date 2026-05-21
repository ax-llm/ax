---
name: ax-ai
description: This skill helps an LLM generate correct AI provider setup and configuration code using @ax-llm/ax. Use when the user asks about ai(), providers, models, presets, embeddings, extended thinking, context caching, or mentions OpenAI/Anthropic/Google/Azure/Groq/DeepSeek/Mistral/Cohere/Together/Ollama/HuggingFace/Reka/OpenRouter with @ax-llm/ax.
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
const azure = ai({ name: 'azure-openai', apiKey: 'your-key', resourceName: 'your-resource', deploymentName: 'gpt-4' });
const groq = ai({ name: 'groq', apiKey: 'gsk_...' });
const deepseek = ai({ name: 'deepseek', apiKey: 'sk-...' });
const mistral = ai({ name: 'mistral', apiKey: 'your-key' });
const cohere = ai({ name: 'cohere', apiKey: 'your-key' });
const together = ai({ name: 'together', apiKey: 'your-key' });
const openrouter = ai({ name: 'openrouter', apiKey: 'your-key' });
const ollama = ai({ name: 'ollama', url: 'http://localhost:11434' });
const hf = ai({ name: 'huggingface', apiKey: 'hf_...' });
const reka = ai({ name: 'reka', apiKey: 'your-key' });
const grok = ai({ name: 'grok', apiKey: 'your-key' });
```

## Model Presets

```typescript
import { ai, AxAIGoogleGeminiModel } from '@ax-llm/ax';

const gemini = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: 'simple' },
  models: [
    { key: 'tiny', model: AxAIGoogleGeminiModel.Gemini20FlashLite, description: 'Fast + cheap', config: { maxTokens: 1024, temperature: 0.3 } },
    { key: 'simple', model: AxAIGoogleGeminiModel.Gemini20Flash, description: 'Balanced', config: { temperature: 0.6 } },
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

Dynamic providers such as Azure OpenAI deployments, OpenRouter, Ollama, and Hugging Face are marked with `isDynamic: true` and may have an empty or static-limited model list.

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
  config: { model: AxAIDeepSeekModel.DeepSeekV4Pro },
});
```

DeepSeek V4 thinking models support tools, but reject the `tool_choice`
request parameter. Ax omits forced/auto tool choice for `deepseek-v4-pro`,
`deepseek-v4-flash`, and `deepseek-reasoner` while still sending tool
definitions.

## Extended Thinking

```typescript
import { ai, AxAIAnthropicModel } from '@ax-llm/ax';

const claude = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: { model: AxAIAnthropicModel.Claude46Opus },
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

- Opus 4.6: adaptive thinking, effort levels
- Opus 4.5: budget_tokens + effort levels (capped at `'high'`)
- Other thinking models: budget tokens only

### Custom Thinking Levels

```typescript
const claude = ai({
  name: 'anthropic',
  apiKey: '...',
  config: {
    model: AxAIAnthropicModel.Claude46Opus,
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
  config: { model: AxAIBedrockModel.ClaudeSonnet4 },
});
```

## Vercel AI SDK Integration

```typescript
import { ai } from '@ax-llm/ax';
import { AxAIProvider } from '@ax-llm/ax-ai-sdk-provider';
import { generateText } from 'ai';

const axAI = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });
const model = new AxAIProvider(axAI);
const result = await generateText({
  model,
  messages: [{ role: 'user', content: 'Hello!' }],
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
- Provider names: `'openai'`, `'anthropic'`, `'google-gemini'`, `'azure-openai'`, `'mistral'`, `'groq'`, `'cohere'`, `'together'`, `'deepseek'`, `'ollama'`, `'huggingface'`, `'openrouter'`, `'reka'`, `'grok'`
- Thinking constraints on Anthropic: `temperature` and `topK` are ignored; `topP` only sent if >= 0.95.
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
- [OpenRouter](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/openrouter.ts) — OpenRouter provider
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
