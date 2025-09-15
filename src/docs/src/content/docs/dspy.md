---
title: "DSPy Concepts"
description: "The revolutionary approach to building with LLMs"
---

# DSPy in TypeScript: The Future of Building with LLMs

## The Problem: LLMs Are Powerful but Unpredictable

Working with LLMs today feels like herding cats. You write prompts, tweak them endlessly, and still get inconsistent results. When you switch models or providers, everything breaks. Sound familiar?

**What if you could just describe what you want, and let the system figure out the best way to get it?**

## Enter DSPy: A Revolutionary Approach

DSPy (Demonstrate–Search–Predict) changes everything. Instead of writing prompts, you write **signatures** – simple declarations of what goes in and what comes out. The framework handles the rest.

Think of it like this:
- **Traditional approach**: "Please analyze the sentiment of this review, considering positive, negative, and neutral tones..."
- **DSPy approach**: `reviewText:string -> sentiment:class "positive, negative, neutral"`

That's it. The system generates optimal prompts, validates outputs, and even improves itself over time.

## See It in Action (30 Seconds)

```typescript
import { ai, ax } from "@ax-llm/ax";

// 1. Pick your LLM
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

// 2. Declare what you want
const classifier = ax('reviewText:string -> sentiment:class "positive, negative, neutral"');

// 3. Just use it
const result = await classifier.forward(llm, { 
  reviewText: "This product exceeded my expectations!" 
});
console.log(result.sentiment); // "positive"
```

**That's a complete, production-ready sentiment analyzer.** No prompt engineering. No trial and error.

## Why DSPy Will Change How You Build

### 1. 🎯 **Write Once, Run Anywhere**
Your code works with OpenAI, Google, Anthropic, or any LLM. Switch providers with one line. No rewrites.

### 2. ⚡ **Stream Everything**
Get results as they generate. Validate on-the-fly. Fail fast. Ship faster.

```typescript
const gen = ax("question:string -> answer:string");
// Stream responses in real-time
await gen.forward(llm, { question: "Hello" }, { stream: true });
```

### 3. 🛡️ **Built-in Quality Control**
Add assertions that run during generation. Catch issues before they reach users.

```typescript
const gen = ax("question:string -> answer:string, confidence:number");

// Method 1: Return error string for custom messages (recommended)
gen.addAssert(({ answer }) => {
  if (answer.length < 10) {
    return `Answer too short: ${answer.length} characters (minimum 10)`;
  }
  return true;
});

// Method 2: Return false with fallback message
gen.addAssert(
  ({ confidence }) => confidence > 0.7,
  "Confidence must be above 70%"
);

// Method 3: Throw for immediate failure
gen.addAssert(({ answer }) => {
  if (answer.includes('offensive-term')) {
    throw new Error('Content moderation failed');
  }
  return true;
});

// Streaming assertions for real-time validation
gen.addStreamingAssert('answer', (content, done) => {
  if (!done) return undefined; // Wait for complete content
  return content.length >= 10 ? true : 'Answer too brief';
});
```

### 4. 🚀 **Automatic Optimization**
Train your programs with examples. Watch them improve automatically.

```typescript
const optimizer = new AxMiPRO({ studentAI: llm, examples: trainingData });
const improved = await optimizer.compile(classifier, examples, metric);
// Your classifier just got 30% more accurate!
```

### 5. 🎨 **Multi-Modal Native**
Images, audio, text – all in the same signature. It just works.

```typescript
const vision = ax("photo:image, question:string -> description:string");
```

## Real-World Power: Build Complex Systems Simply

### Smart Customer Support in 5 Lines

```typescript
const supportBot = ax(`
  customerMessage:string -> 
  category:class "billing, technical, general",
  priority:class "high, medium, low",
  suggestedResponse:string
`);

// That's it. You have intelligent ticket routing and response generation.
```

### Multi-Step Reasoning? Trivial.

```typescript
const researcher = ax(`
  question:string -> 
  searchQueries:string[] "3-5 queries",
  analysis:string,
  confidence:number "0-1"
`);
```

## Beyond Simple Generation: Production Features

### Complete Observability
- OpenTelemetry tracing built-in
- Track every decision, optimization, and retry
- Monitor costs, latency, and quality in real-time

### Enterprise-Ready Workflows
AxFlow lets you compose signatures into complex pipelines with automatic parallelization:

```typescript
new AxFlow()
  .node("analyzer", "text:string -> sentiment:string")
  .node("summarizer", "text:string -> summary:string")
  .execute("analyzer", (state) => ({ text: state.text }))
  .execute("summarizer", (state) => ({ text: state.text }))
  // Both run in parallel automatically!
```

### Advanced RAG Out of the Box
```typescript
const rag = axRAG(vectorDB, {
  maxHops: 3,           // Multi-hop retrieval
  qualityTarget: 0.85,  // Self-healing quality loops
});
// Enterprise RAG in 3 lines
```

## Start Now: From Zero to Production

### Install (30 seconds)
```bash
npm install @ax-llm/ax
```

### Your First Intelligent App (2 minutes)
```typescript
import { ai, ax } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

// Create any AI capability with a signature
const translator = ax(`
  text:string, 
  targetLanguage:string -> 
  translation:string,
  confidence:number "0-1"
`);

const result = await translator.forward(llm, {
  text: "Hello world",
  targetLanguage: "French"
});
// { translation: "Bonjour le monde", confidence: 0.95 }
```

## The Bottom Line

**Stop fighting with prompts. Start building with signatures.**

DSPy isn't just another LLM library. It's a fundamental shift in how we build AI systems:
- **Deterministic** where it matters (structure, types, validation)
- **Flexible** where you need it (providers, models, optimization)
- **Production-ready** from day one (streaming, observability, scaling)

## Ready to Build the Future?

### Quick Wins
- [Simple Examples](https://github.com/ax-llm/ax/blob/main/src/examples/) - Start here
- [Streaming Magic](https://github.com/ax-llm/ax/blob/main/src/examples/streaming1.ts) - Real-time validation
- [Multi-Modal](https://github.com/ax-llm/ax/blob/main/src/examples/multi-modal.ts) - Images + text together

### Level Up
- [Optimization Guide](/optimize/) - Make your programs smarter
- [AxFlow Workflows](/axflow/) - Build complex systems
- [Advanced RAG](/axrag/) - Production search & retrieval

### Join the Revolution
- 🐦 [Follow Updates](https://twitter.com/dosco)
- 💬 [Discord Community](https://discord.gg/DSHg3dU7dW)
- ⭐ [Star on GitHub](https://github.com/ax-llm/ax)

---

**Remember**: Every prompt you write today is technical debt. Every signature you write is an asset that gets better over time.

Welcome to the future of building with LLMs. Welcome to DSPy with Ax.