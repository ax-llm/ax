---
title: "AI Providers"
description: "Complete guide to all supported AI providers and their features"
---

## Getting Started with Ax AI Providers and Models

This guide helps beginners get productive with Ax quickly: pick a provider, choose a model, and send a request. You’ll also learn how to define model presets and common options.

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
import { ai } from '@ax-llm/ax'

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: 'gemini-2.0-flash',
  },
})
```

Supported providers include: `openai`, `anthropic`, `google-gemini`, `mistral`, `groq`, `cohere`, `together`, `deepseek`, `ollama`, `huggingface`, `openrouter`, `azure-openai`, `reka`, `x-grok`.

### 3. Choose models using presets (recommended)

Define a `models` list with user-friendly keys. Each item describes a preset and can include provider-specific settings. When you use a key in `model`, Ax maps it to the right backend model and merges the preset config.

```ts
import { ai } from '@ax-llm/ax'

const gemini = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: 'simple' },
  models: [
    {
      key: 'tiny',
      model: 'gemini-2.0-flash-lite',
      description: 'Fast + cheap',
      // Provider config merged automatically
      config: { maxTokens: 1024, temperature: 0.3 },
    },
    {
      key: 'simple',
      model: 'gemini-2.0-flash',
      description: 'Balanced general-purpose',
      config: { temperature: 0.6 },
    },
  ],
})

// Use a preset by key
await gemini.chat({
  model: 'tiny',
  chatPrompt: [{ role: 'user', content: 'Summarize this:' }],
})
```

What gets merged when you pick a key:

- Model mapping: preset `model` replaces the key
- Tuning: `maxTokens`, `temperature`, `topP`, `topK`, penalties, `stopSequences`, `n`, `stream`
- Provider extras (Gemini): `config.thinking.thinkingTokenBudget` is mapped to Ax’s levels automatically; `includeThoughts` maps to `showThoughts`

You can still override per-request:

```ts
await gemini.chat(
  { model: 'simple', chatPrompt: [{ role: 'user', content: 'Hi' }] },
  { stream: false, thinkingTokenBudget: 'medium' },
)
```

### 4. Send your first chat

```ts
const res = await gemini.chat({
  chatPrompt: [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Write a haiku about the ocean.' },
  ],
})

console.log(res.results[0]?.content)
```

### 5. Common options

- `stream` (boolean): enable server-sent events; `true` by default if supported
- `thinkingTokenBudget` (Gemini/Claude-like): `'minimal' | 'low' | 'medium' | 'high' | 'highest' | 'none'`
- `showThoughts` (if model supports): include thoughts in output
- `functionCallMode`: `'auto' | 'native' | 'prompt'`
- `debug`, `logger`, `tracer`, `rateLimiter`, `timeout`

Example with overrides:

```ts
await gemini.chat(
  { chatPrompt: [{ role: 'user', content: 'Plan a weekend trip' }] },
  { stream: false, thinkingTokenBudget: 'high', showThoughts: true },
)
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