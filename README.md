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

### Complex Structured Outputs (New!)

Define deeply nested objects with full type safety using the fluent API:

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

// Full TypeScript inference for nested fields
console.log(result.product.specs.dimensions.width); // number
console.log(result.product.reviews[0].comment);     // string
```

### Validation & Constraints (New!)

Add Zod-like validation constraints to ensure data quality and format:

```typescript
import { f, ax } from "@ax-llm/ax";

const userRegistration = f()
  .input("userData", f.string())
  .output("user", f.object({
    username: f.string().min(3).max(20),
    email: f.string().email(),
    age: f.number().min(18).max(120),
    password: f.string().min(8).regex("^(?=.*[A-Za-z])(?=.*\\d)", "Must contain at least one letter and one digit"),
    bio: f.string().max(500).optional(),
    website: f.string().url().optional(),
    tags: f.string().min(2).max(30).array()
  }))
  .build();

const generator = ax(userRegistration);
const result = await generator.forward(llm, {
  userData: "Name: John, Email: john@example.com, Age: 25..."
});

// All fields are automatically validated:
// - username: 3-20 characters
// - email: valid email format
// - age: between 18-120
// - password: min 8 chars with letter and number
// - website: valid URL format if provided
// - tags: each 2-30 characters
```

**Available Constraints:**
- `.min(n)` / `.max(n)` - String length or number range
- `.email()` - Email format validation (or use `f.email()`)
- `.url()` - URL format validation (or use `f.url()`)
- `.date()` - Date format validation (or use `f.date()`)
- `.datetime()` - Datetime format validation (or use `f.datetime()`)
- `.regex(pattern, description)` - Custom regex pattern with human-readable description
- `.optional()` - Make field optional

**Note:** For email, url, date, and datetime, you can use either the validator syntax (`f.string().email()`) or the dedicated type syntax (`f.email()`). Both work consistently in all contexts!

**Automatic Features:**
- ✅ Input validation before sending to LLM
- ✅ Output validation after LLM response
- ✅ JSON Schema constraints in structured outputs
- ✅ Automatic retry with corrections on validation errors
- ✅ TypeScript compile-time protection

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

## Powerful Features, Zero Complexity

- ✅ **15+ LLM Providers** - OpenAI, Anthropic, Google, Mistral, Ollama, and
  more
- ✅ **Type-Safe Everything** - Full TypeScript support with auto-completion
- ✅ **Streaming First** - Real-time responses with validation
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

## OpenAI-Compatible Providers

Many platforms expose an OpenAI-compatible API (Groq, Cerebras, Fireworks, Vercel AI Gateway, custom proxies, etc.). Configure them with the new `openai-compatible` provider:

```typescript
const llm = ai({
  name: "openai-compatible",
  apiKey: process.env.AI_COMPAT_API_KEY!,
  endpoint: process.env.AI_COMPAT_API_URL!, // e.g. https://api.groq.com/openai/v1
  headers: { "x-gateway-name": "prod-cluster" }, // optional vendor headers
  config: {
    model: process.env.AI_COMPAT_MODEL ?? "groq/llama3-70b-8192",
    stream: false,
  },
});
```

- **Groq:** set `endpoint` to `https://api.groq.com/openai/v1` and avoid unsupported params such as `logit_bias`, `logprobs`, `messages[].name`, or `n` values other than `1`.
- **Cerebras:** use `https://api.cerebras.ai/v1` and omit `frequency_penalty`, `presence_penalty`, `logit_bias`, and `service_tier`. Pass vendor-specific flags via `extra_body` (see their docs).
- **Vercel AI Gateway / custom proxies:** point `endpoint` at the gateway URL (e.g., `https://gateway.ai.cloudflare.com/.../openai`) and add any routing headers required by your setup.

Set `AI_COMPAT_API_KEY` (or reuse `AI_GATEWAY_API_KEY`) plus `AI_COMPAT_API_URL` before running examples like `npm run tsx src/examples/openai-compatible.ts`.

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
- [openai-compatible.ts](src/examples/openai-compatible.ts) - Connect to Groq, Cerebras, Vercel AI Gateway, or custom OpenAI-compatible endpoints

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
