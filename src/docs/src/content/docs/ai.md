---
title: "AI Providers"
description: "Complete guide to all supported AI providers and their features"
---

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

### 6. Embeddings (if supported)

```ts
const { embeddings } = await gemini.embed({
  texts: ['hello', 'world'],
  embedModel: 'text-embedding-005',
})
``;

### 7. Tips

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
