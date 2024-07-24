---
title: Quick Start
description: Jump into building with Ax
---

Building intelligent agents is a breeze with the Ax framework, inspired by the power of "Agentic workflows" and the Stanford DSPy paper. It seamlessly integrates with multiple LLMs and VectorDBs to build RAG pipelines or collaborative agents that can solve complex problems. Plus, it offers advanced features like streaming validation, multi-modal DSPy, etc.

## Install

With NPM

```console
npm install @ax-llm/ax
```

With Yarn

```console
yarn add @ax-llm/ax
```

## Pick an LLM

Ax is a zero-dependency framework. Every LLM API integration we build is solid, works well with Ax, and supports all required features, such as function calling, multi-modal, JSON, streaming, etc.

Currently we support `"openai" | "azure-openai" | "together" | "anthropic" | "groq" | "google-gemini" | "cohere" | "huggingface" | "mistral" | "deepseek" | "ollama"`

```typescript
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});
```

The LLMs are pre-configured with sensible defaults such as models and other conifgurations such as topK, temperature, etc

## Prompting

Prompts are usually stressful and complex. You never know what the right prompt is, and blobs of text in your code are hard to deal with. We fix this by adopting the prompt signatures from the popular Stanford DSPy paper.

A prompt signature is a list of _typed_ input and output fields along with a task description prefix.
the following fields are supported `'string' | 'number' | 'boolean' | 'json' | 'image'` add a `[]` to convert a field into an array field eg. `string[]`, `number[]`, etc. Additionally a `?` marks the field as an optional field `context?:string`.

**Summarize some text**

```
textToSummarize -> shortSummary "summarize in 5 to 10 words"
```

**Answer questions using a multi-modal prompt that takes a question and an image**

```
"answer biology questions about animals"
question:string, animalImage:image -> answer:string
```

**A prompt that ensures the response is a numeric list**

```
"Rate the quality of each answer on a scale of 1 to 10 against the question"
question:string, answers:string[] -> rating:number[]
```

## Putting it all together

Use the above AI and a prompt to build an LLM-powered program to summarize the text.

```typescript
// example.ts
import { AxAI, AxChainOfThought } from '@ax-llm/ax';

const textToSummarize = `
The technological singularity—or simply the singularity[1]—is a hypothetical 
future point in time at which technological growth becomes uncontrollable 
and irreversible, resulting in unforeseeable changes to human 
civilization.[2][3] ...`;

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

const prompt = `textToSummarize -> shortSummary "summarize in 5 to 10 words"`;

const gen = new AxChainOfThought(ai, prompt);
const res = await gen.forward({ textToSummarize });

console.log(res);
```

```console title="Use tsx, node or bun to run the example"
tsx example.ts

{
    shortSummary: "The technological singularity refers to a
    hypothetical future scenario where technological..."
}
```

## Build your first agent

Ax makes it really simple to build agents. An agent requires a `name`, `description` and `signature`. it can optionally use `functions` and other `agents`.

**Example Stock Analyst Agent**
The Stock Analyst Agent is an advanced AI-powered tool that provides comprehensive stock analysis and financial insights. It combines multiple specialized sub-agents and functions to deliver in-depth evaluations of stocks, market trends, and related financial data.

This is only an example, but it highlights the power of agentic workflows, where you can build agents who work with agents to handle complex tasks.

```typescript title="Stock Analyst Agent"
const agent = new AxAgent(ai, {
  name: 'Stock Analyst',
  description:
    'An AI agent specialized in analyzing stocks, market trends, and providing financial insights.',
  signature: `
    stockSymbol:string, 
    analysisType:string "fundamental, technical or sentiment" -> analysisReport`,
  functions: [
    getStockData,
    calculateFinancialRatios,
    analyzeTechnicalIndicators,
    performSentimentAnalysis
  ],
  agents: [
    financialDataCollector,
    marketTrendAnalyzer,
    newsAnalyzer,
    sectorAnalyst,
    competitorAnalyzer,
    riskAssessor,
    valuationExpert,
    economicIndicatorAnalyzer,
    insiderTradingMonitor,
    esgAnalyst
  ]
});
```

**Example of agents working with other agents**

```typescript
// ./src/examples/agent.ts

const researcher = new AxAgent(ai, {
  name: 'researcher',
  description: 'Researcher agent',
  signature: `physicsQuestion "physics questions" -> answer "reply in bullet points"`
});

const summarizer = new AxAgent(ai, {
  name: 'summarizer',
  description: 'Summarizer agent',
  signature: `text "text so summarize" -> shortSummary "summarize in 5 to 10 words"`
});

const agent = new AxAgent(ai, {
  name: 'agent',
  description: 'A an agent to research complex topics',
  signature: `question -> answer`,
  agents: [researcher, summarizer]
});

agent.forward({ questions: 'How many atoms are there in the universe' });
```
