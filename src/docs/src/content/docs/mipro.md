---
title: "MiPRO: Multi-Prompt Optimization"
description: "Automatic prompt and few-shot example optimization for improved AI performance"
---

# MiPRO: Multi-Prompt Optimization

MiPRO (Multi-Prompt Optimization) is the recommended optimizer for most use cases. It automatically optimizes both prompts and few-shot examples to improve your AI program's performance.

## What is MiPRO?

Think of MiPRO like having a writing tutor for your AI. Instead of manually tweaking prompts and examples, MiPRO automatically:

- **Writes better prompts** for your AI programs
- **Picks the best examples** to show your AI what you want
- **Saves you money** by making cheaper models work as well as expensive ones
- **Improves accuracy** without you having to be a prompt engineering expert

**Real example**: A sentiment analysis that goes from 70% accuracy to 90% accuracy automatically, while reducing costs by 80%.

## When to Use MiPRO

✅ **Great for:**

- Classification tasks (sentiment, categories, etc.)
- When you have some example data (even just 5-10 examples!)
- When accuracy matters more than speed
- When you want to save money on API calls
- Repetitive tasks you do often

❌ **Skip for now:**

- Simple one-off tasks
- When you have no training examples
- Creative writing tasks (poems, stories)
- When you need results immediately (optimization takes 1-5 minutes)

## Quick Start

### Step 1: Create Your Program

```typescript
import { ai, ax, AxMiPRO } from "@ax-llm/ax";

// Define what you want the AI to do
const sentimentAnalyzer = ax(
  'reviewText:string "Customer review" -> sentiment:class "positive, negative, neutral" "How the customer feels"',
);

// Set up your AI
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" },
});
```

### Step 2: Provide Training Examples

```typescript
const examples = [
  { reviewText: "I love this product!", sentiment: "positive" },
  { reviewText: "This is terrible quality", sentiment: "negative" },
  { reviewText: "It works fine, nothing special", sentiment: "neutral" },
  { reviewText: "Best purchase ever!", sentiment: "positive" },
  { reviewText: "Waste of money", sentiment: "negative" },
];
```

### Step 3: Define Success Metric

```typescript
const metric = ({ prediction, example }) => {
  return prediction.sentiment === example.sentiment ? 1 : 0;
};
```

### Step 4: Run Optimization

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  options: { verbose: true },
});

console.log("🔄 Optimizing your AI program...");
const result = await optimizer.compile(sentimentAnalyzer, examples, metric);

// Apply the improvements
if (result.optimizedProgram) {
  sentimentAnalyzer.applyOptimization(result.optimizedProgram);
  console.log(`✅ Improved to ${result.bestScore * 100}% accuracy`);
}
```

### Step 5: Save and Load

```typescript
import { promises as fs } from "fs";
import { AxOptimizedProgramImpl } from "@ax-llm/ax";

// Save the optimization
await fs.writeFile(
  "optimization.json",
  JSON.stringify({
    version: "2.0",
    bestScore: result.optimizedProgram.bestScore,
    instruction: result.optimizedProgram.instruction,
    demos: result.optimizedProgram.demos,
    modelConfig: result.optimizedProgram.modelConfig,
    optimizerType: result.optimizedProgram.optimizerType,
    timestamp: new Date().toISOString(),
  }, null, 2)
);

// Load in production
const savedData = JSON.parse(await fs.readFile("optimization.json", "utf8"));
const optimizedProgram = new AxOptimizedProgramImpl(savedData);
sentimentAnalyzer.applyOptimization(optimizedProgram);
```

## Teacher-Student Setup

Use an expensive model as a "teacher" to make a cheap model perform better.

```typescript
// Teacher: Smart but expensive (only used during optimization)
const teacherAI = ai({
  name: "openai",
  config: { model: "gpt-4o" },
});

// Student: Fast and cheap (used for actual work)
const studentAI = ai({
  name: "openai",
  config: { model: "gpt-4o-mini" },
});

const optimizer = new AxMiPRO({
  studentAI,
  teacherAI,
  examples,
  options: { verbose: true },
});
```

**Real savings**: Instead of paying $0.03 per 1K tokens, you pay $0.0006 per 1K tokens after optimization - that's 50x cheaper!

## Self-Consistency (MiPRO v2)

MiPRO v2 introduces self-consistency: asking the model for multiple independent samples and picking the best.

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  sampleCount: 3, // Ask for 3 independent samples
});
```

### Custom Result Picker

```typescript
import { type AxResultPickerFunction } from "@ax-llm/ax";

const myPicker: AxResultPickerFunction<any> = async (data) => {
  if (data.type === "function") {
    const ix = data.results.findIndex((r) => !r.isError);
    return ix >= 0 ? ix : 0;
  }

  // Choose highest confidence
  let bestIx = 0;
  let bestScore = -Infinity;
  for (const r of data.results) {
    const sample = r.sample as { confidence?: number };
    const score = sample.confidence ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestIx = r.index;
    }
  }
  return bestIx;
};

const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  sampleCount: 5,
  resultPicker: myPicker,
});
```

## Configuration Options

### Basic Options

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  teacherAI: teacherLLM, // Optional
  examples,
  options: {
    verbose: true,           // Show progress
    numTrials: 8,            // Number of optimization trials
    numCandidates: 10,       // Candidate instructions per round
    minibatch: true,         // Use minibatch evaluation
    minibatchSize: 25,       // Examples per minibatch
    seed: 42,                // For reproducibility
  },
});
```

### Advanced Options

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,

  // Early stopping
  earlyStoppingTrials: 5,
  minImprovementThreshold: 0.01,

  // Minibatch scheduling
  minibatch: true,
  minibatchFullEvalSteps: 10,

  // Python service
  optimizerEndpoint: "http://localhost:8000",
  bayesianOptimization: true,

  // Cost control
  costTracker: new AxDefaultCostTracker({ maxCost: 5 }),
});
```

## Best Practices

### 1. Better Examples = Better Results

❌ **Bad examples** (too similar):
```typescript
const badExamples = [
  { text: "I love it", sentiment: "positive" },
  { text: "I like it", sentiment: "positive" },
  { text: "I enjoy it", sentiment: "positive" },
];
```

✅ **Good examples** (diverse):
```typescript
const goodExamples = [
  { text: "I love this product!", sentiment: "positive" },
  { text: "Terrible quality, broke immediately", sentiment: "negative" },
  { text: "It works fine, nothing special", sentiment: "neutral" },
  { text: "Best purchase ever made!", sentiment: "positive" },
  { text: "Completely useless waste of money", sentiment: "negative" },
];
```

### 2. Start Small, Then Scale

**Phase 1**: Start with 5-10 examples
```typescript
const optimizer = new AxMiPRO({
  studentAI,
  examples: examples.slice(0, 10),
  options: { numTrials: 3, verbose: true },
});
```

**Phase 2**: Scale up if results are good
```typescript
const optimizer = new AxMiPRO({
  studentAI,
  teacherAI,
  examples: allExamples,
  options: { numTrials: 8, verbose: true },
});
```

### 3. Control Costs

```typescript
import { AxDefaultCostTracker } from "@ax-llm/ax";

const costTracker = new AxDefaultCostTracker({
  maxTokens: 10000,
  maxCost: 5,
});

const optimizer = new AxMiPRO({
  studentAI,
  examples,
  costTracker,
  options: {
    numTrials: 3,
    earlyStoppingTrials: 2,
  },
});
```

## Python Optimization Service

For advanced Bayesian optimization, MiPRO can use a Python service with Optuna.

### Quick Setup

```bash
# Install and run
cd src/optimizer
uv sync
uv run ax-optimizer server start --debug
```

### Using with MiPRO

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,

  // Python service configuration
  optimizerEndpoint: "http://localhost:8000",
  bayesianOptimization: true,
  numTrials: 100,

  // Self-consistency
  sampleCount: 3,
});
```

## Examples

- `src/examples/mipro-python-optimizer.ts` - Complete MiPRO example with Python service

## See Also

- [Optimization Guide](/optimize) - Main optimization guide
- [GEPA](/gepa) - Multi-objective optimization
- [ACE](/ace) - Agentic Context Engineering
