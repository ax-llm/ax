---
title: "Documentation"
description: "Ax - Build Reliable AI Apps in TypeScript"
---

# Ax: Build Reliable AI Apps in TypeScript

**Stop wrestling with prompts. Start shipping AI features.**

Ax brings DSPy's revolutionary approach to TypeScript – just describe what you want, and let the framework handle the rest. Production-ready, type-safe, and works with all major LLMs.

[![NPM Package](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=green)](https://www.npmjs.com/package/@ax-llm/ax)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://img.shields.io/discord/1078454354849304667?style=for-the-badge&color=green)](https://discord.gg/DSHg3dU7dW)

## Transform Your AI Development in 30 Seconds

```typescript
import { ai, ax } from "@ax-llm/ax";

// 1. Pick any LLM
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

// 2. Say what you want
const classifier = ax('review:string -> sentiment:class "positive, negative, neutral"');

// 3. Get type-safe results
const result = await classifier.forward(llm, { 
  review: "This product is amazing!" 
});
console.log(result.sentiment); // "positive" ✨
```

**That's it.** No prompt engineering. No trial and error. It works with GPT-4, Claude, Gemini, or any LLM.

## Why Thousands of Developers Choose Ax

### 🎯 **Define Once, Run Anywhere**
Write your logic once. Switch between OpenAI, Anthropic, Google, or 15+ providers with one line. No rewrites needed.

### ⚡ **Ship 10x Faster**
Stop tweaking prompts. Define inputs → outputs. The framework generates optimal prompts automatically.

### 🛡️ **Production-Ready from Day One**
Built-in streaming, validation, error handling, observability. Used by startups in production handling millions of requests.

### 🚀 **Gets Smarter Over Time**
Train your programs with examples. Watch accuracy improve automatically. No ML expertise needed.

## Real Apps, Real Simple

### Intelligent Customer Support
```typescript
const supportAgent = ax(`
  message:string -> 
  category:class "billing, technical, general",
  priority:class "high, medium, low",
  response:string
`);
// Complete ticket routing + response generation in 4 lines
```

### Multi-Modal Analysis
```typescript
const analyzer = ax("image:image, question:string -> answer:string");
// Computer vision without the complexity
```

### Smart Document Processing
```typescript
const extractor = ax(`
  document:string -> 
  summary:string,
  keyPoints:string[],
  actionItems:string[]
`);
// Extract structured data from any document
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
  language: "Spanish"
});
console.log(result.translation); // "Hola mundo"
```

## Powerful Features, Zero Complexity

- ✅ **15+ LLM Providers** - OpenAI, Anthropic, Google, Mistral, Ollama, and more
- ✅ **Type-Safe Everything** - Full TypeScript support with auto-completion
- ✅ **Streaming First** - Real-time responses with validation
- ✅ **Multi-Modal** - Images, audio, text in the same signature
- ✅ **Smart Optimization** - Automatic prompt tuning with MiPRO
- ✅ **Production Observability** - OpenTelemetry tracing built-in
- ✅ **Advanced Workflows** - Compose complex pipelines with AxFlow
- ✅ **Enterprise RAG** - Multi-hop retrieval with quality loops
- ✅ **Agent Framework** - Agents that can use tools and call other agents
- ✅ **Zero Dependencies** - Lightweight, fast, reliable

## Learn More

### 🚀 Quick Wins
- [**Getting Started Guide**](https://github.com/ax-llm/ax/blob/main/QUICKSTART.md) - Set up in 5 minutes
- [**DSPy Concepts**](https://github.com/ax-llm/ax/blob/main/DSPY.md) - Understand the revolutionary approach
- [**Examples**](#examples) - Copy-paste templates for common use cases

### 📚 Deep Dives
- [**AxFlow Workflows**](https://github.com/ax-llm/ax/blob/main/AXFLOW.md) - Build complex AI systems
- [**Optimization Guide**](https://github.com/ax-llm/ax/blob/main/OPTIMIZE.md) - Make your programs smarter
- [**Advanced RAG**](https://github.com/ax-llm/ax/blob/main/AXRAG.md) - Production search & retrieval
- [**API Reference**](https://github.com/ax-llm/ax/blob/main/API.md) - Complete documentation

## Examples

Run any example:
```bash
OPENAI_APIKEY=your-key npm run tsx ./src/examples/[example-name].ts
```

### Essential Examples
- [summarize.ts](src/examples/summarize.ts) - Text summarization
- [simple-classify.ts](src/examples/simple-classify.ts) - Classification tasks
- [agent.ts](src/examples/agent.ts) - Agent framework basics
- [streaming1.ts](src/examples/streaming1.ts) - Real-time streaming
- [multi-modal.ts](src/examples/multi-modal.ts) - Image + text processing

### Production Patterns
- [customer-support.ts](src/examples/customer-support.ts) - Customer service automation
- [advanced-rag.ts](src/examples/advanced-rag.ts) - Enterprise RAG implementation
- [ax-flow.ts](src/examples/ax-flow.ts) - Complex workflow orchestration
- [tune-mipro.ts](src/examples/tune-mipro.ts) - Automatic optimization

[View All 50+ Examples →](src/examples/)

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

MIT - Use it anywhere, build anything.

---

**Ready to build the future?** Stop fighting with prompts. Start shipping with signatures.

```bash
npm install @ax-llm/ax
```

*Built with ❤️ by developers, for developers.*