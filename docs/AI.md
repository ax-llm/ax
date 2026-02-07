## Getting Started with Ax AI Providers and Models

This guide helps beginners get productive with Ax quickly: pick a provider,
choose a model, and send a request. You’ll also learn how to define model
presets and common options.

### 1. Install and set up

```bash
npm i @ax-llm/ax
```

Set your API keys as environment variables:

- `OPENAI_APIKEY`
- `ANTHROPIC_APIKEY`
- `GOOGLE_APIKEY` (or Google Vertex setup)

### 2. Create an AI instance

Use the `ai()` factory with a provider name and your API key.

```ts
import { ai, AxAIGoogleGeminiModel } from "@ax-llm/ax";

const llm = ai({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini20Flash,
  },
});
```

Supported providers include: `openai`, `anthropic`, `google-gemini`, `mistral`,
`groq`, `cohere`, `together`, `deepseek`, `ollama`, `huggingface`, `openrouter`,
`azure-openai`, `reka`, `x-grok`.

### 3. Choose models using presets (recommended)

Define a `models` list with user-friendly keys. Each item describes a preset and
can include provider-specific settings. When you use a key in `model`, Ax maps
it to the right backend model and merges the preset config.

```ts
import { ai, AxAIGoogleGeminiModel } from "@ax-llm/ax";

const gemini = ai({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: "simple" },
  models: [
    {
      key: "tiny",
      model: AxAIGoogleGeminiModel.Gemini20FlashLite,
      description: "Fast + cheap",
      // Provider config merged automatically
      config: { maxTokens: 1024, temperature: 0.3 },
    },
    {
      key: "simple",
      model: AxAIGoogleGeminiModel.Gemini20Flash,
      description: "Balanced general-purpose",
      config: { temperature: 0.6 },
    },
  ],
});

// Use a preset by key
await gemini.chat({
  model: "tiny",
  chatPrompt: [{ role: "user", content: "Summarize this:" }],
});
```

What gets merged when you pick a key:

- Model mapping: preset `model` replaces the key
- Tuning: `maxTokens`, `temperature`, `topP`, `topK`, penalties,
  `stopSequences`, `n`, `stream`
- Provider extras (Gemini): `config.thinking.thinkingTokenBudget` is mapped to
  Ax’s levels automatically; `includeThoughts` maps to `showThoughts`

You can still override per-request:

```ts
await gemini.chat(
  { model: "simple", chatPrompt: [{ role: "user", content: "Hi" }] },
  { stream: false, thinkingTokenBudget: "medium" },
);
```

### 4. Send your first chat

```ts
const res = await gemini.chat({
  chatPrompt: [
    { role: "system", content: "You are concise." },
    { role: "user", content: "Write a haiku about the ocean." },
  ],
});

console.log(res.results[0]?.content);
```

### 5. Common options

- `stream` (boolean): enable server-sent events; `true` by default if supported
- `thinkingTokenBudget` (Gemini/Claude-like):
  `'minimal' | 'low' | 'medium' | 'high' | 'highest' | 'none'`
- `showThoughts` (if model supports): include thoughts in output
- `functionCallMode`: `'auto' | 'native' | 'prompt'`
- `debug`, `logger`, `tracer`, `rateLimiter`, `timeout`

Example with overrides:

```ts
await gemini.chat(
  { chatPrompt: [{ role: "user", content: "Plan a weekend trip" }] },
  { stream: false, thinkingTokenBudget: "high", showThoughts: true },
);
```

### 6. Extended Thinking

Extended thinking allows models to reason internally before responding, improving
quality on complex tasks. Ax provides a unified `thinkingTokenBudget` interface
that works across providers (Anthropic, Google Gemini) while handling
provider-specific details automatically.

#### Usage

Pass `thinkingTokenBudget` and optionally `showThoughts` when making requests:

```ts
import { ai, AxAIAnthropicModel } from "@ax-llm/ax";

// Anthropic
const claude = ai({
  name: "anthropic",
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: { model: AxAIAnthropicModel.Claude46Opus },
});

const res = await claude.chat(
  { chatPrompt: [{ role: "user", content: "Solve this step by step..." }] },
  { thinkingTokenBudget: "medium", showThoughts: true },
);

console.log(res.results[0]?.thought); // The model's internal reasoning
console.log(res.results[0]?.content); // The final answer
```

```ts
import { ai, AxAIGoogleGeminiModel } from "@ax-llm/ax";

// Google Gemini
const gemini = ai({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini25Pro },
});

const res = await gemini.chat(
  { chatPrompt: [{ role: "user", content: "Analyze this complex problem..." }] },
  { thinkingTokenBudget: "high", showThoughts: true },
);
```

#### Budget levels

The string levels map to provider-specific token budgets:

| Level | Anthropic (tokens) | Gemini (tokens) |
| --- | --- | --- |
| `'none'` | disabled | minimal (Gemini 3+ can't fully disable) |
| `'minimal'` | 1,024 | 200 |
| `'low'` | 5,000 | 800 |
| `'medium'` | 10,000 | 5,000 |
| `'high'` | 20,000 | 10,000 |
| `'highest'` | 32,000 | 24,500 |

#### Anthropic model-specific behavior

Ax automatically selects the right wire format based on the Anthropic model:

- **Opus 4.6**: Uses adaptive thinking (`type: 'adaptive'`) + effort levels. No
  explicit token budget is sent — the model decides how much to think. The
  `thinkingTokenBudget` level controls the effort parameter instead.
- **Opus 4.5**: Uses explicit budget (`budget_tokens`) + effort levels. Effort
  is capped at `'high'` (the `'max'` effort level is not supported).
- **Other thinking models** (Claude 3.7 Sonnet, Claude 4 Sonnet, etc.): Uses
  budget tokens only, no effort parameter.

#### Effort levels

For Opus 4.5+ models, Ax automatically maps your `thinkingTokenBudget` level to
an Anthropic effort level (`low` / `medium` / `high` / `max`). You don't need
to set effort manually. The default mapping is:

| Budget level | Effort |
| --- | --- |
| `'minimal'` | `low` |
| `'low'` | `low` |
| `'medium'` | `medium` |
| `'high'` | `high` |
| `'highest'` | `max` |

You can customize this via the `effortLevelMapping` config (see below).

#### Customization

Override the default token budgets or effort mapping in your provider config:

```ts
const claude = ai({
  name: "anthropic",
  apiKey: process.env.ANTHROPIC_APIKEY!,
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
      minimal: "low",
      low: "medium",
      medium: "high",
      high: "high",
      highest: "max",
    },
  },
});
```

#### Constraints

When thinking is enabled on Anthropic, the API restricts certain parameters:

- `temperature` is ignored (cannot be set)
- `topK` is ignored (cannot be set)
- `topP` is only sent if its value is >= 0.95

These restrictions are handled automatically — Ax omits the restricted
parameters from the request when thinking is active.

### 7. Embeddings (if supported)

```ts
const { embeddings } = await gemini.embed({
  texts: ['hello', 'world'],
  embedModel: 'text-embedding-005',
})
``;

### 8. Context Caching

Context caching reduces costs and latency by caching large prompt prefixes
(system prompts, function definitions, examples) for reuse across multiple
requests. This is especially valuable for multi-turn agentic flows.

#### Enabling Context Caching

Pass the `contextCache` option to `forward()` to enable caching:

```ts
import { ai, ax, AxMemory } from "@ax-llm/ax";

const llm = ai({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY!,
});

const codeReviewer = ax(
  `code:string, language:string -> review:string, suggestions:string[]`,
  { description: "You are an expert code reviewer..." } // Large system prompt
);

const mem = new AxMemory();

// Enable context caching
const result = await codeReviewer.forward(llm, { code, language }, {
  mem,
  sessionId: "code-review-session",
  contextCache: {
    ttlSeconds: 3600, // Cache TTL (1 hour)
  },
});
```

#### How It Works

**Google Gemini (Explicit Caching)**:

- Creates a separate cache resource with an ID
- Cache persists across requests using the same `sessionId` + content hash
- Automatic TTL refresh when cache is near expiration
- Provides up to 90% cost reduction on cached tokens
- Minimum 2048 tokens required for caching

**Anthropic (Implicit Caching)**:

- Uses `cache_control` markers in the request
- System prompts are automatically cached
- Function definitions and results are marked for caching
- No explicit cache management needed
- Provides up to 90% cost reduction on cached tokens

#### Configuration Options

```ts
type AxContextCacheOptions = {
  // Explicit cache name (bypasses auto-creation)
  name?: string;

  // TTL in seconds (default: 3600)
  ttlSeconds?: number;

  // Minimum tokens to create cache (default: 2048)
  minTokens?: number;

  // Window before expiration to trigger refresh (default: 300)
  refreshWindowSeconds?: number;

  // External registry for serverless environments
  registry?: AxContextCacheRegistry;

  // Controls where the cache breakpoint is set in the prompt prefix
  // Prefix order: System → Functions → Examples → User Input
  // - 'after-examples' (default): Cache includes system + functions + examples
  // - 'after-functions': Cache system + functions only (use when examples are dynamic)
  // - 'system': Cache only system prompt (use when functions are dynamic)
  cacheBreakpoint?: 'system' | 'after-functions' | 'after-examples';
};
```

#### Dynamic Examples (Excluding from Cache)

When examples are dynamic (e.g., retrieved per-request from a vector database),
use `cacheBreakpoint: 'after-functions'` to exclude them from caching:

```ts
const result = await gen.forward(llm, input, {
  contextCache: {
    ttlSeconds: 3600,
    cacheBreakpoint: 'after-functions', // Cache system + functions, but not examples
  },
});
```

Similarly, if both examples and functions are dynamic, use `cacheBreakpoint: 'system'`
to cache only the system prompt.

#### Multi-Turn Function Calling with Caching

When using functions/tools, caching is automatically applied:

```ts
import { ai, ax, type AxFunction } from "@ax-llm/ax";

const tools: AxFunction[] = [
  {
    name: "calculate",
    description: "Evaluate a math expression",
    parameters: { type: "object", properties: { expression: { type: "string" } } },
    func: ({ expression }) => eval(expression),
  },
];

const agent = ax("question:string -> answer:string", {
  description: "You are a helpful assistant...",
  functions: tools,
});

const llm = ai({ name: "google-gemini", apiKey: process.env.GOOGLE_APIKEY! });

// Tools and function results are automatically cached
const result = await agent.forward(llm, { question: "What is 2^10?" }, {
  contextCache: { ttlSeconds: 3600 },
});
```

#### External Cache Registry (Serverless)

For serverless environments where in-memory state is lost, use an external
registry:

```ts
// Redis-backed registry example
const registry: AxContextCacheRegistry = {
  get: async (key) => {
    const data = await redis.get(`cache:${key}`);
    return data ? JSON.parse(data) : undefined;
  },
  set: async (key, entry) => {
    await redis.set(`cache:${key}`, JSON.stringify(entry), "EX", 3600);
  },
};

const result = await gen.forward(llm, input, {
  sessionId: "my-session",
  contextCache: {
    ttlSeconds: 3600,
    registry,
  },
});
```

#### Supported Models

**Gemini (Explicit Caching)**:

- Gemini 3 Flash/Pro
- Gemini 2.5 Pro/Flash/Flash-Lite
- Gemini 2.0 Flash/Flash-Lite

**Anthropic (Implicit Caching)**:

- All Claude models support implicit caching

### 9. Tips

- Prefer presets: gives friendly names and consistent tuning across your app
- Start with fast/cheap models for iteration; switch keys later without code changes
- Use `stream: false` in tests for simpler assertions
- In the browser, set `corsProxy` if needed

For more examples, see the examples directory and provider-specific docs.

---

## AWS Bedrock Provider

The `@ax-llm/ax-ai-aws-bedrock` package provides production-ready AWS Bedrock integration supporting Claude, GPT OSS, and Titan Embed models.

### Installation

```bash
npm install @ax-llm/ax @ax-llm/ax-ai-aws-bedrock
```

### Quick Start

```typescript
import { AxAIBedrock, AxAIBedrockModel } from "@ax-llm/ax-ai-aws-bedrock";
import { ax } from "@ax-llm/ax";

const ai = new AxAIBedrock({
  region: "us-east-2",
  config: { model: AxAIBedrockModel.ClaudeSonnet4 },
});

const generator = ax("question:string -> answer:string");
const result = await generator.forward(ai, {
  question: "What is AWS Bedrock?",
});

console.log(result.answer);
```

### Configuration

```typescript
const ai = new AxAIBedrock({
  region: "us-east-2", // Primary AWS region
  fallbackRegions: ["us-west-2", "us-east-1"], // Fallback regions for Claude
  gptRegion: "us-west-2", // Primary region for GPT models
  gptFallbackRegions: ["us-east-1"], // Fallback regions for GPT
  config: {
    model: AxAIBedrockModel.ClaudeSonnet4,
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
  },
});
```

### Supported Models

**Claude Models:**

- `AxAIBedrockModel.ClaudeSonnet4` - Claude Sonnet 4
- `AxAIBedrockModel.ClaudeOpus4` - Claude Opus 4
- `AxAIBedrockModel.Claude35Sonnet` - Claude 3.5 Sonnet
- `AxAIBedrockModel.Claude35Haiku` - Claude 3.5 Haiku
- `AxAIBedrockModel.Claude3Opus` - Claude 3 Opus

**GPT Models:**

- `AxAIBedrockModel.Gpt41106` - GPT-4 1106 Preview
- `AxAIBedrockModel.Gpt4Mini` - GPT-4o Mini

**Embedding Models:**

- `AxAIBedrockEmbedModel.TitanEmbedV2` - Titan Embed V2

### Regional Failover

The provider automatically handles regional failover for high availability. If the primary region fails, it retries with fallback regions.

### AWS Authentication

Uses AWS SDK's default credential chain:

- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- AWS credentials file (`~/.aws/credentials`)
- IAM roles (EC2/Lambda)

---

## Vercel AI SDK Integration

The `@ax-llm/ax-ai-sdk-provider` package provides seamless integration with the Vercel AI SDK v5.

### Installation

```bash
npm install @ax-llm/ax @ax-llm/ax-ai-sdk-provider ai
```

### Basic Usage

```typescript
import { ai } from "@ax-llm/ax";
import { AxAIProvider } from "@ax-llm/ax-ai-sdk-provider";
import { generateText, streamText } from "ai";

// Create Ax AI instance
const axAI = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
});

// Create AI SDK v5 compatible provider
const model = new AxAIProvider(axAI);

// Use with AI SDK functions
const result = await generateText({
  model,
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(result.text);
```

### Streaming with React Server Components

```typescript
import { ai } from "@ax-llm/ax";
import { AxAIProvider } from "@ax-llm/ax-ai-sdk-provider";
import { streamUI } from "ai/rsc";

const axAI = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
});

const model = new AxAIProvider(axAI);

const result = await streamUI({
  model,
  messages: [{ role: "user", content: "Tell me a story" }],
  text: ({ content }) => <p>{content}</p>,
});
```

### Agent Provider

Use Ax agents with the AI SDK:

```typescript
import { ai, agent } from "@ax-llm/ax";
import { AxAgentProvider } from "@ax-llm/ax-ai-sdk-provider";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

const myAgent = agent("userInput:string -> response:string", {
  name: "helper",
  description: "A helpful assistant",
  ai: llm,
});

const agentProvider = new AxAgentProvider({
  agent: myAgent,
  updateState: (msgs) => {
    /* handle state updates */
  },
  generate: (result) => <div>{result.response}</div>,
});
```

### Features

- AI SDK v5 `LanguageModelV2` compatible
- Full tool/function calling support
- Streaming with lifecycle events
- Multi-modal inputs (text, images, files)
- Full TypeScript support

---

## Ax Tools Package

The `@ax-llm/ax-tools` package provides additional tools for Ax including MCP (Model Context Protocol) support and a JavaScript interpreter.

### Installation

```bash
npm install @ax-llm/ax @ax-llm/ax-tools
```

### MCP Stdio Transport

Connect to MCP servers via stdio:

```typescript
import { AxMCPClient } from "@ax-llm/ax";
import { axCreateMCPStdioTransport } from "@ax-llm/ax-tools";

// Create transport for an MCP server
const transport = axCreateMCPStdioTransport({
  command: "npx",
  args: ["-y", "@anthropic/mcp-server-filesystem"],
  env: { HOME: process.env.HOME },
});

// Use with AxMCPClient
const client = new AxMCPClient(transport);
await client.init();

const tools = await client.getTools();
console.log("Available tools:", tools.map((t) => t.name));
```

### JavaScript Interpreter

A sandboxed JavaScript interpreter that can be used as a function tool:

```typescript
import { ai, ax } from "@ax-llm/ax";
import {
  AxJSInterpreter,
  AxJSInterpreterPermission,
} from "@ax-llm/ax-tools";

// Create interpreter with specific permissions
const interpreter = new AxJSInterpreter({
  permissions: [
    AxJSInterpreterPermission.CRYPTO,
    AxJSInterpreterPermission.OS,
  ],
});

// Use as a function tool
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

const codeRunner = ax("task:string -> result:string", {
  functions: [interpreter.toFunction()],
});

const result = await codeRunner.forward(llm, {
  task: "Calculate the factorial of 10",
});
```

### Permissions

Control what the interpreter can access:

| Permission | Description |
| ---------- | ----------- |
| `FS` | File system access (`node:fs`) |
| `NET` | Network access (`http`, `https`) |
| `OS` | OS information (`node:os`) |
| `CRYPTO` | Cryptographic functions |
| `PROCESS` | Process information |

```typescript
import { AxJSInterpreterPermission } from "@ax-llm/ax-tools";

const interpreter = new AxJSInterpreter({
  permissions: [
    AxJSInterpreterPermission.FS,
    AxJSInterpreterPermission.NET,
  ],
});
```
