---
title: "Migration Guide"
description: "Migration guide for the next Ax major release cleanup"
---

# Migration Guide

This major release removes the old compatibility surfaces that were kept during
the factory API transition. New code should use the factory functions and the
current optimizer/artifact model.

## Use Factories

```typescript
import { ai, ax, s, flow } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY });
const sig = s("question:string -> answer:string");
const gen = ax("question:string -> answer:string");
const workflow = flow<{ question: string }>();
```

Removed constructor paths:

- `new AxAI(...)`
- `new AxSignature(...)`
- `new AxFlow(...)`

Tagged template forms were also removed. Use `ax("...")` and `s("...")`.

## Provider Changes

Wrapper/platform providers were removed from the core package:

- Groq
- Together
- OpenRouter
- Ollama
- WebLLM

Use the OpenAI provider for custom OpenAI-compatible endpoints:

```typescript
const gateway = ai({
  name: "openai",
  apiURL: "https://api.example.com/v1",
  apiKey: process.env.OPENAI_COMPAT_APIKEY,
  models: [
    { key: "default", model: "provider/model-name", description: "Default model" },
  ],
  config: { model: "default" },
});
```

Kept providers include OpenAI, OpenAI Responses, Azure OpenAI, Anthropic,
Gemini, Mistral, Cohere, Reka, DeepSeek, and Grok/xAI.

## Removed Subsystems

The old document/RAG/vector database stack has been removed:

- `AxApacheTika`
- `AxDB*`
- `AxDBManager`
- `AxDefaultResultReranker`
- `axRAG`

The old classifier helpers were removed:

- `AxSimpleClassifier`
- `AxSimpleClassifierClass`

The old self-improvement stack was removed:

- `AxLearn`
- `axLearn`
- `AxACE`
- trace logger/storage/checkpoint compatibility types

Use GEPA, `agent.optimize(...)`, and `AxBootstrapFewShot` for retained
optimization workflows.

## Removed Compatibility Aliases

Use the current names and artifact shapes:

- `actorTurnCallback` instead of `executorTurnCallback`
- `AxJSRuntime` through the `runtime` option instead of `AxCodeInterpreter`
- `f(...)` instead of `createFieldType(...)`
- `fn(...).arg(...)` instead of `fn(...).args(...)`
- prompt examples now render through the current message-pair prompt path
- optimized artifacts should use `componentMap`; the legacy top-level
  `instruction` fallback is gone
