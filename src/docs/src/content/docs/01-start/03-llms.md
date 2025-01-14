---
title: Supported LLMs
description: Using various LLMs
---

Ax supports all the top LLM providers and models, along with their advanced capabilities, such as function calling, multi-modal, streaming, and JSON.

Our defaults, including default models, are selected to ensure solid agent performance.

### OpenAI

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});
```

```typescript title="Customized"
const ai = new AxAI({
 name: 'openai',
 apiKey: process.env.OPENAI_APIKEY as string
 config: {
    model: AxAIOpenAIModel.GPT4Turbo,
    embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small
    temperature: 0.1,
 }
});
```

### Azure OpenAI

Azure requires you to set a resource name and a deployment name

https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/create-resource?pivots=web-portal

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'azure-openai',
  apiKey: process.env.AZURE_OPENAI_APIKEY as string,
  resourceName: 'test-resource',
  deploymentName: 'test-deployment'
});
```

### Together

Together runs a diverse array of open-source models, each designed for a specific use case. This variety ensures that you can find the perfect model for your needs.

https://docs.together.ai/docs/inference-models

```typescript title="With custom models"
const ai = new AxAI({
  name: 'together',
  apiKey: process.env.TOGETHER_APIKEY as string,
  config: {
    model: 'Qwen/Qwen1.5-0.5B-Chat'
  }
});
```

### Anthropic

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY as string
});
```

### Groq

Groq uses specialized hardware to serve open-source models with the lowest latency. It supports a small number of good models.

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'groq',
  apiKey: process.env.GROQ_APIKEY as string
});
```

### Google Gemini

An excellent model family with very long context lengths at the lowest price points. Gemini has built-in support for compute (code execution); their models can write and run code in the backend if needed.

```typescript title="Use defaults, enable code execution"
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_GEMINI_APIKEY as string
  options: { codeExecution: true }
});
```

### Cohere

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'cohere',
  apiKey: process.env.COHERE_APIKEY as string
});
```

### Mistral

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'mistral',
  apiKey: process.env.MISTRAL_APIKEY as string
});
```

### Deepseek

Deepseek is an LLM provider from China that has excellent models.

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'deepseek',
  apiKey: process.env.DEEPSEEK_APIKEY as string
});
```

### Ollama

Ollama is an engine for running open-source models locally on your laptop. We default to `nous-hermes21` for inference and `all-minilm` for embedding.

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'ollama',
  apiKey: process.env.DEEPSEEK_APIKEY as string,
  url: 'http://localhost:11434'
  config: { model: 'nous-hermes2', embedModel: 'all-minilm' }
});
```

### Huggingface

```typescript title="Use defaults"
const ai = new AxAI({
  name: 'huggingface',
  apiKey: process.env.HF_APIKEY as string
});
```
