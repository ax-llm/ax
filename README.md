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

### 🛡️ **Production-Ready from Day One**

Built-in streaming, validation, error handling, observability. Used by startups
in production handling millions of requests.

### 🚀 **Gets Smarter Over Time**

Train your programs with examples. Watch accuracy improve automatically. No ML
expertise needed.

## Real Apps, Real Simple

### Extract Structured Data from Customer Emails

```typescript
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

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
// Automatically extracts all fields with proper types and validation
```

### Build Agents That Use Tools (ReAct Pattern)

```typescript
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

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

### Fluent Signature API

```typescript
import { ai, ax, f } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

const signature = f()
  .input("userQuestion", f.string("User question"))
  .output("responseText", f.string("AI response"))
  .output("confidenceScore", f.number("Confidence 0-1"))
  .build();

const generator = ax(signature.toString());
const result = await generator.forward(llm, { userQuestion: "What is Ax?" });
console.log(result.responseText, result.confidenceScore);
```

### Bring Your Own Zod Schemas

Reuse existing validation schemas without rewriting them:

```typescript
import { AxSignature, ax } from "@ax-llm/ax";
import { z } from "zod";

const ticketSignature = AxSignature.fromZod({
  description: "Summarize support tickets",
  input: z.object({
    subject: z.string(),
    body: z.string(),
    urgency: z.enum(["low", "normal", "high"]).optional(),
  }),
  output: z.object({
    summary: z.string(),
    sentiment: z.enum(["positive", "neutral", "negative"]),
  }),
});

// Inspect any downgrades programmatically
console.log(ticketSignature.getZodConversionIssues());

// Quickly audit a schema
AxSignature.debugZodConversion({
  input: z.object({
    subject: z.string(),
    body: z.string(),
  }),
});

// Emit a warning-style report when issues exist
ticketSignature.reportZodConversionIssues();

// Need the Zod schemas back out (e.g. for adapters)?
const { input: inputSchema, output: outputSchema } = ticketSignature.toZod({
  warnOnFallback: false,
});
if (inputSchema && outputSchema) {
  type TicketInput = z.input<typeof inputSchema>;
  type TicketOutput = z.output<typeof outputSchema>;
}

const summarize = ax(ticketSignature);
```

## Powerful Features, Zero Complexity

- ✅ **15+ LLM Providers** - OpenAI, Anthropic, Google, Mistral, Ollama, and
  more
- ✅ **Type-Safe Everything** - Full TypeScript support with auto-completion
- ✅ **Streaming First** - Real-time responses with validation
- ✅ **Zod-Friendly** - Convert schemas with automatic fallbacks and warnings
- ✅ **Round-Trip Friendly** - Regenerate Zod objects from signatures when you need adapters
- ✅ **Downgrade Awareness** - Records/maps/unions stay `json` but are flagged so you can adjust early
- ✅ **Multi-Modal** - Images, audio, text in the same signature
- ✅ **Smart Optimization** - Automatic prompt tuning with MiPRO
- ✅ **Agentic Context Engineering** - ACE generator → reflector → curator loops
- ✅ **Multi-Objective Optimization** - GEPA and GEPA-Flow (Pareto frontier)
- ✅ **Production Observability** - OpenTelemetry tracing built-in
- ✅ **Advanced Workflows** - Compose complex pipelines with AxFlow
- ✅ **Enterprise RAG** - Multi-hop retrieval with quality loops
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
- [**Signatures Guide**](https://github.com/ax-llm/ax/blob/main/docs/SIGNATURES.md) -
  Design expressive, type-safe signatures

### 📚 Deep Dives

- [**AxFlow Workflows**](https://github.com/ax-llm/ax/blob/main/docs/AXFLOW.md) -
  Build complex AI systems
- [**Optimization Guide (MiPRO, ACE, GEPA, GEPA-Flow)**](https://github.com/ax-llm/ax/blob/main/docs/OPTIMIZE.md) -
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

- [customer-support.ts](src/examples/customer-support.ts) - Complete support
  system
- [food-search.ts](src/examples/food-search.ts) - Restaurant recommendations
  with tools
- [simple-optimizer-test.ts](src/examples/simple-optimizer-test.ts) - Automatic
  optimization
- [mipro-python-optimizer.ts](src/examples/mipro-python-optimizer.ts) - Advanced
  MIPRO optimization
- [gepa-quality-vs-speed-optimization.ts](src/examples/gepa-quality-vs-speed-optimization.ts) -
  Multi-objective GEPA optimization (quality vs speed trade-offs)
- [ace-train-inference.ts](src/examples/ace-train-inference.ts) - ACE playbook
  growth with offline + online updates
- [ax-flow-enhanced-demo.ts](src/examples/ax-flow-enhanced-demo.ts) - Complex
  workflows

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

## Contributors

- Author: [@dosco](https://github.com/dosco)
- GEPA and ACE optimizer implementations:
  [@monotykamary](https://github.com/monotykamary)

## License

Apache 2 - Use it anywhere, build anything.

---

**Ready to build the future?** Stop fighting with prompts. Start shipping with
signatures.

```bash
npm install @ax-llm/ax
```

_Built with ❤️ by developers, for developers._
