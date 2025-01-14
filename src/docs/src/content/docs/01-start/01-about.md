---
title: About Ax
description: The best framework to build LLM powered agents
---

Building intelligent agents is a breeze with the Ax framework, inspired by the power of "Agentic workflows" and the Stanford DSPy paper. It seamlessly integrates with multiple LLMs and VectorDBs to build RAG pipelines or collaborative agents that can solve complex problems. Plus, it offers advanced features like streaming validation, multi-modal DSPy, etc.

Large language models (LLMs) are becoming really powerful and have reached a point where they can work as the backend for your entire product. However, there's still a lot of complexity to manage from using the correct prompts, models, streaming, function calls, error correction, and much more. We aim help manage this complexity via this easy-to-use library that can work with all state-of-the-art LLMs. Additionally, we are using the latest research to add new capabilities like DSPy to the library.

## Install

With NPM

```console
npm install @ax-llm/ax
```

With Yarn

```console
yarn add @ax-llm/ax
```

## Features

- Support for various LLMs and Vector DBs
- Prompts auto-generated from simple signatures
- Build Agents that can call other agents
- Convert docs of any format to text
- RAG, smart chunking, embedding, querying
- Works with Vercel AI SDK
- Output validation while streaming
- Multi-modal DSPy supported
- Automatic prompt tuning using optimizers
- OpenTelemetry tracing / observability
- Production ready Typescript code
- Lite weight, zero-dependencies


## Quick Start

1. Pick an AI to work with

```ts
// Pick a LLM
const ai = new AxOpenAI({ apiKey: process.env.OPENAI_APIKEY } as AxOpenAIArgs);
```

2. Create a prompt signature based on your usecase

```ts
// Signature defines the inputs and outputs of your prompt program
const cot = new AxGen(ai, `question:string -> answer:string`, { mem });
```

3. Execute this new prompt program

```ts
// Pass in the input fields defined in the above signature
const res = await cot.forward({ question: 'Are we in a simulation?' });
```

4. Or if you just want to directly use the LLM

```ts
const res = await ai.chat([
  { role: "system", content: "Help the customer with his questions" }
  { role: "user", content: "I'm looking for a Macbook Pro M2 With 96GB RAM?" }
]);
```

## Reach out

https://twitter.com/dosco
