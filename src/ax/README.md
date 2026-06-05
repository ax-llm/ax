# Ax: Build Reliable AI Apps in TypeScript

**Stop wrestling with prompts. Start shipping AI features.**

Ax brings DSPy's revolutionary approach to TypeScript – just describe what you
want, and let the framework handle the rest. Production-ready, type-safe, and
works with all major LLMs.

[![NPM Package](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=green)](https://www.npmjs.com/package/@ax-llm/ax)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://img.shields.io/discord/1078454354849304667?style=for-the-badge&color=green)](https://discord.gg/DSHg3dU7dW)

## Transform Your AI Development in 30 Seconds

```typescript
import { ai, ax } from "@ax-llm/ax";

// 1. Pick any LLM
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

// 2. Say what you want
const classifier = ax(
  'review:string -> sentiment:class "positive, negative, neutral"',
);

// 3. Get type-safe results
const result = await classifier.forward(llm, {
  review: "This product is amazing!",
});
console.log(result.sentiment); // "positive" ✨
```

**That's it.** No prompt engineering. No trial and error. It works with GPT-4,
Claude, Gemini, or any LLM.

## Why Thousands of Developers Choose Ax

### 🎯 **Define Once, Run Anywhere**

Write your logic once. Switch between OpenAI, Anthropic, Google, or 15+
providers with one line. No rewrites needed.

### ⚡ **Ship 10x Faster**

Stop tweaking prompts. Define inputs → outputs. The framework generates optimal
prompts automatically.

### ⚡ **Provider-Native Speed**

Ax stays in the same latency class as direct provider calls while adding typed
outputs, validation, retries, tracing, and tools. Streaming is the default so Ax
can parse fields as they arrive, fail early on streaming assertions, cancel bad
outputs, and start correction without wasting tokens on completions that are
already invalid.

Benchmark the current code against your own providers:

```bash
AX_STREAM_BENCH_PROVIDER=anthropic AX_STREAM_BENCH_MODEL=claude-sonnet-4-5-20250929 AX_STREAM_BENCH_RUNS=2 AX_STREAM_BENCH_WARMUP_RUNS=0 npm run tsx src/examples/streaming-latency.ts
AX_STREAM_BENCH_PROVIDER=google-gemini AX_STREAM_BENCH_MODEL=gemini-2.5-flash AX_STREAM_BENCH_RUNS=2 AX_STREAM_BENCH_WARMUP_RUNS=0 npm run tsx src/examples/streaming-latency.ts
```

### 🛡️ **Production-Ready from Day One**

Built-in streaming, validation, error handling, observability. Used by startups
in production handling millions of requests.

### 🚀 **Gets Smarter Over Time**

Train your programs with examples. Watch accuracy improve automatically. No ML
expertise needed.

## Real Apps, Real Simple

### Extract Structured Data from Customer Emails

```typescript
const extractor = ax(`
  customerEmail:string, currentDate:datetime -> 
  priority:class "high, normal, low",
  sentiment:class "positive, negative, neutral",
  ticketNumber?:number,
  nextSteps:string[],
  estimatedResponseTime:string
`);

const result = await extractor.forward(ai, {
  customerEmail: "Order #12345 hasn't arrived. Need this resolved immediately!",
  currentDate: new Date(),
});
// Automatically extracts all fields with proper types and validation
```

### Build Agents That Use Tools (ReAct Pattern)

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

const result = await assistant.forward(ai, {
  question: "What's the weather in Tokyo and any news about it?",
});
// AI automatically calls both functions and combines results
```

### Multi-Modal Analysis with Images

```typescript
const analyzer = ax(`
  image:image, question:string ->
  description:string,
  mainColors:string[],
  category:class "electronics, clothing, food, other",
  estimatedPrice:string
`);
// Process images and text together seamlessly
```

## Quick Start

### Install

```bash
npm install @ax-llm/ax
```

### Your First AI Feature (2 minutes)

```typescript
import { ai, ax } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

const translator = ax(`
  text:string, 
  language:string -> 
  translation:string
`);

const result = await translator.forward(llm, {
  text: "Hello world",
  language: "Spanish",
});
console.log(result.translation); // "Hola mundo"
```

## Powerful Features, Zero Complexity

- ✅ **Model-Lab Providers** - OpenAI, Anthropic, Google, Mistral, DeepSeek,
  Grok/xAI, and more
- ✅ **Type-Safe Everything** - Full TypeScript support with auto-completion
- ✅ **Streaming First** - Real-time responses with validation
- ✅ **Multi-Modal** - Images, audio, text in the same signature
- ✅ **Smart Optimization** - Automatic prompt tuning with GEPA and bootstrap demos
- ✅ **Production Observability** - OpenTelemetry tracing built-in
- ✅ **Advanced Workflows** - Compose complex pipelines with AxFlow
- ✅ **Agent Framework** - Agents that can use tools and call other agents
- ✅ **Zero Dependencies** - Lightweight, fast, reliable

## Learn More

### 🚀 Quick Wins

- [**Getting Started Guide**](https://github.com/ax-llm/ax/blob/main/docs/QUICKSTART.md) -
  Set up in 5 minutes
- [**Examples Guide**](https://github.com/ax-llm/ax/blob/main/docs/EXAMPLES.md) -
  Comprehensive examples with explanations
- [**DSPy Concepts**](https://github.com/ax-llm/ax/blob/main/docs/DSPY.md) -
  Understand the revolutionary approach

### 📚 Deep Dives

- [**AxFlow Workflows**](https://github.com/ax-llm/ax/blob/main/docs/AXFLOW.md) -
  Build complex AI systems
- [**Optimization Guide**](https://github.com/ax-llm/ax/blob/main/docs/OPTIMIZE.md) -
  Make your programs smarter
- [**Advanced RAG**](https://github.com/ax-llm/ax/blob/main/docs/AXRAG.md) -
  Production search & retrieval
- [**API Reference**](https://github.com/ax-llm/ax/blob/main/docs/API.md) -
  Complete documentation

## Examples

Run any example:

```bash
OPENAI_APIKEY=your-key npm run tsx ./src/examples/[example-name].ts
```

### Core Examples

- [extract.ts](src/examples/extract.ts) - Extract structured data from text
- [react.ts](src/examples/react.ts) - ReAct pattern with function calling
- [agent.ts](src/examples/agent.ts) - Multi-agent collaboration
- [streaming1.ts](src/examples/streaming1.ts) - Real-time streaming responses
- [multi-modal.ts](src/examples/multi-modal.ts) - Image + text processing

### Production Patterns

- [customer-support.ts](src/examples/customer-support.ts) - Complete support system
- [food-search.ts](src/examples/food-search.ts) - Restaurant recommendations with tools
- [simple-optimizer-test.ts](src/examples/simple-optimizer-test.ts) - Automatic optimization
- [axagent-gepa-optimization.ts](src/examples/axagent-gepa-optimization.ts) - Agent optimization with GEPA
- [ax-flow-enhanced-demo.ts](src/examples/ax-flow-enhanced-demo.ts) - Complex workflows

[📚 **View Full Examples Guide** →](docs/EXAMPLES.md)\
[View All 70+ Examples →](src/examples/)

## Join the Community

- 🐦 [Follow on Twitter](https://twitter.com/dosco) - Latest updates
- 💬 [Discord Community](https://discord.gg/DSHg3dU7dW) - Get help, share ideas
- ⭐ [Star on GitHub](https://github.com/ax-llm/ax) - Support the project
- 📖 [Ask DeepWiki](https://deepwiki.com/ax-llm/ax) - AI-powered docs

## Production Ready

- ✅ **Battle-tested** - Used by startups in production
- ✅ **No breaking changes** - Stable minor versions
- ✅ **Comprehensive tests** - Large test coverage
- ✅ **OpenTelemetry** - Built-in observability
- ✅ **TypeScript first** - Type-safe by design

## License

Apache 2 - Use it anywhere, build anything.

---

**Ready to build the future?** Stop fighting with prompts. Start shipping with
signatures.

```bash
npm install @ax-llm/ax
```

_Built with ❤️ by developers, for developers._
