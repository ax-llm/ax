---
title: "Documentation"
description: "Ax - Build Reliable AI Apps in TypeScript"
---

# Ax - Build Reliable AI Apps in TypeScript with DSPy

Ax brings DSPy's approach to TypeScript – describe what you want, and let the framework handle the rest. Production-ready, type-safe, works with all major LLMs.

[![NPM Package](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=green)](https://www.npmjs.com/package/@ax-llm/ax)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://img.shields.io/discord/1078454354849304667?style=for-the-badge&color=green)](https://discord.gg/DSHg3dU7dW)

## The Problem

Building with LLMs is painful. You write prompts, test them, they break. You switch providers, everything needs rewriting. You add validation, error handling, retries – suddenly you're maintaining infrastructure instead of shipping features.

## The Solution

Define what goes in and what comes out. Ax handles the rest.

```typescript
import { ai, ax } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY });

const classifier = ax(
  'review:string -> sentiment:class "positive, negative, neutral"',
);

const result = await classifier.forward(llm, {
  review: "This product is amazing!",
});

console.log(result.sentiment); // "positive"
```

No prompt engineering. No trial and error. Works with GPT-4, Claude, Gemini, or any LLM.

## Why Ax

**Write once, run anywhere.** Switch between OpenAI, Anthropic, Google, or 15+ providers with one line. No rewrites.

**Ship faster.** Stop tweaking prompts. Define inputs and outputs. The framework generates optimal prompts automatically.

**Production-ready.** Built-in streaming, validation, error handling, observability. Used in production handling millions of requests.

**Gets smarter.** Train your programs with examples. Watch accuracy improve automatically. No ML expertise needed.

## Examples

### Extract structured data

```typescript
const extractor = ax(`
  customerEmail:string, currentDate:datetime -> 
  priority:class "high, normal, low",
  sentiment:class "positive, negative, neutral",
  ticketNumber?:number,
  nextSteps:string[],
  estimatedResponseTime:string
`);

const result = await extractor.forward(llm, {
  customerEmail: "Order #12345 hasn't arrived. Need this resolved immediately!",
  currentDate: new Date(),
});
```

### Complex nested objects

```typescript
import { f, ax } from "@ax-llm/ax";

const productExtractor = f()
  .input("productPage", f.string())
  .output("product", f.object({
    name: f.string(),
    price: f.number(),
    specs: f.object({
      dimensions: f.object({
        width: f.number(),
        height: f.number()
      }),
      materials: f.array(f.string())
    }),
    reviews: f.array(f.object({
      rating: f.number(),
      comment: f.string()
    }))
  }))
  .build();

const generator = ax(productExtractor);
const result = await generator.forward(llm, { productPage: "..." });

// Full TypeScript inference
console.log(result.product.specs.dimensions.width);
console.log(result.product.reviews[0].comment);
```

### Validation and constraints

```typescript
const userRegistration = f()
  .input("userData", f.string())
  .output("user", f.object({
    username: f.string().min(3).max(20),
    email: f.string().email(),
    age: f.number().min(18).max(120),
    password: f.string().min(8).regex("^(?=.*[A-Za-z])(?=.*\\d)", "Must contain letter and digit"),
    bio: f.string().max(500).optional(),
    website: f.string().url().optional(),
  }))
  .build();
```

Available constraints: `.min(n)`, `.max(n)`, `.email()`, `.url()`, `.date()`, `.datetime()`, `.regex(pattern, description)`, `.optional()`

Validation runs on both input and output. Automatic retry with corrections on validation errors.

### Agents with tools (ReAct pattern)

```typescript
const assistant = ax(
  "question:string -> answer:string",
  {
    functions: [
      { name: "getCurrentWeather", func: weatherAPI },
      { name: "searchNews", func: newsAPI },
    ],
  },
);

const result = await assistant.forward(llm, {
  question: "What's the weather in Tokyo and any news about it?",
});
```

### AxAgent + RLM for long context

```typescript
import { agent, AxJSRuntime } from "@ax-llm/ax";

const analyzer = agent(
  "context:string, query:string -> answer:string, evidence:string[]",
  {
    name: "documentAnalyzer",
    description: "Analyze very long documents with recursive code + sub-queries",
    maxSteps: 20,
    rlm: {
      contextFields: ["context"],
      runtime: new AxJSRuntime(),
      maxLlmCalls: 40,
      maxRuntimeChars: 2_000, // Shared cap for llmQuery context + interpreter output
      maxBatchedLlmQueryConcurrency: 6,
      subModel: "gpt-4o-mini",
    },
  },
);

const result = await analyzer.forward(llm, {
  context: veryLongDocument,
  query: "What are the main arguments and supporting evidence?",
});
```

RLM mode keeps long context out of the root prompt, runs iterative analysis in a persistent runtime session, and uses bounded sub-queries for semantic extraction (typically targeting <=10k chars per sub-call).

### AxJSRuntime

`AxJSRuntime` is the built-in JavaScript runtime used by RLM and tool-style execution.
It works across:

- Node.js/Bun-style backends (worker_threads runtime path)
- Deno backends (module worker path)
- Browser environments (Web Worker path)

It supports:

- Persistent sessions via `createSession()`
- Function tool usage via `toFunction()`
- Sandbox permissions via `AxJSRuntimePermission`

### Multi-modal (images, audio)

```typescript
const analyzer = ax(`
  image:image, question:string ->
  description:string,
  mainColors:string[],
  category:class "electronics, clothing, food, other",
  estimatedPrice:string
`);
```

## Install

```bash
npm install @ax-llm/ax
```

Additional packages:

```bash
# AWS Bedrock provider
npm install @ax-llm/ax-ai-aws-bedrock

# Vercel AI SDK v5 integration
npm install @ax-llm/ax-ai-sdk-provider

# Tools: MCP stdio transport, JS runtime
npm install @ax-llm/ax-tools
```

## Features

- **15+ LLM Providers** – OpenAI, Anthropic, Google, Mistral, Ollama, and more
- **Type-safe** – Full TypeScript support with auto-completion
- **Streaming** – Real-time responses with validation
- **Multi-modal** – Images, audio, text in the same signature
- **Optimization** – Automatic prompt tuning with MiPRO, ACE, GEPA
- **Observability** – OpenTelemetry tracing built-in
- **Workflows** – Compose complex pipelines with AxFlow
- **RAG** – Multi-hop retrieval with quality loops
- **Agents** – Tools and multi-agent collaboration
- **RLM in AxAgent** – Long-context analysis with recursive runtime loops
- **Zero dependencies** – Lightweight, fast, reliable

## Documentation

**Get Started**
- [Quick Start Guide](/quickstart/) – Set up in 5 minutes
- [Examples Guide](/examples/) – Comprehensive examples
- [DSPy Concepts](/dspy/) – Understanding the approach
- [Signatures Guide](/signatures/) – Type-safe signature design

**Deep Dives**
- [AI Providers](/ai/) – All providers, AWS Bedrock, Vercel AI SDK
- [AxFlow Workflows](/axflow/) – Build complex AI systems
- [Optimization (MiPRO, ACE, GEPA)](/optimize/) – Make programs smarter
- [AxAgent & RLM](/axagent/) – Agents, child agents, tools, and RLM for long contexts
- [Advanced RAG](/axrag/) – Production search and retrieval

## Run Examples

```bash
OPENAI_APIKEY=your-key npm run tsx ./src/examples/[example-name].ts
```

Core examples: `extract.ts`, `react.ts`, `agent.ts`, `streaming1.ts`, `multi-modal.ts`

Production patterns: `customer-support.ts`, `food-search.ts`, `rlm.ts`, `ace-train-inference.ts`, `ax-flow-enhanced-demo.ts`

[View all 70+ examples](https://github.com/ax-llm/ax/blob/main/src/examples/)

## Community

- [Twitter](https://twitter.com/dosco) – Updates
- [Discord](https://discord.gg/DSHg3dU7dW) – Help and discussion
- [GitHub](https://github.com/ax-llm/ax) – Star the project
- [DeepWiki](https://deepwiki.com/ax-llm/ax) – AI-powered docs

## Production Ready

- Battle-tested in production
- Stable minor versions
- Comprehensive test coverage
- OpenTelemetry built-in
- TypeScript first

## Contributors

- Author: [@dosco](https://github.com/dosco)
- GEPA and ACE optimizers: [@monotykamary](https://github.com/monotykamary)

## License

Apache 2.0

---

```bash
npm install @ax-llm/ax
```
