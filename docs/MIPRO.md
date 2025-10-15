# MiPRO: Multi-Prompt Optimization

MiPRO (Multi-Prompt Optimization) is the recommended optimizer for most use cases. It automatically optimizes both prompts and few-shot examples to improve your AI program's performance.

## Table of Contents

- [What is MiPRO?](#what-is-mipro)
- [When to Use MiPRO](#when-to-use-mipro)
- [Quick Start](#quick-start)
- [Python Optimization Service](#python-optimization-service)
- [Self-Consistency (MiPRO v2)](#self-consistency-mipro-v2)
- [Teacher-Student Setup](#teacher-student-setup)
- [Configuration Options](#configuration-options)
- [Hyperparameter Tuning](#hyperparameter-tuning)
- [Early Stopping and Minibatch](#early-stopping-and-minibatch)
- [Checkpointing](#checkpointing)
- [Best Practices](#best-practices)

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
import { AxOptimizedProgramImpl } from "@ax-llm/ax";
const savedData = JSON.parse(await fs.readFile("optimization.json", "utf8"));
const optimizedProgram = new AxOptimizedProgramImpl(savedData);
sentimentAnalyzer.applyOptimization(optimizedProgram);
```

## Python Optimization Service

For advanced optimization requiring sophisticated Bayesian optimization, MiPRO uses a production-ready Python service using Optuna.

**Note:** MiPro v2 requires the Python service; local TypeScript fallback is no longer supported.

### Quick Setup with uv

```bash
# 1. Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Navigate to optimizer directory
cd src/optimizer

# 3. Install and run
uv sync
uv run ax-optimizer server start --debug
```

### Using MiPRO with Python Service

```typescript
import { ai, ax, type AxMetricFn, AxMiPRO } from "@ax-llm/ax";

const optimizer = new AxMiPRO({
  studentAI: ai({ name: "openai", config: { model: "gpt-4o-mini" } }),
  teacherAI: ai({ name: "openai", config: { model: "gpt-4" } }),
  examples,

  // Python service configuration
  optimizerEndpoint: "http://localhost:8000",
  optimizerTimeout: 60000,
  optimizerRetries: 3,

  // Enhanced MiPRO settings
  numTrials: 100,
  bayesianOptimization: true,
  acquisitionFunction: "expected_improvement",
  explorationWeight: 0.15,

  // Self-consistency (MiPRO v2)
  sampleCount: 3,

  // Progress tracking
  onProgress: (update) => {
    console.log(`Trial ${update.round}: ${update.currentScore.toFixed(3)}`);
  },
});

const result = await optimizer.compile(emailClassifier, examples, metric);
```

## Self-Consistency (MiPRO v2)

MiPRO v2 introduces self-consistency: asking the model for multiple independent samples and picking the best with a default majority-vote picker.

### Basic Usage

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

  // Choose highest confidence; tie-breaker shortest explanation
  let bestIx = 0;
  let bestScore = -Infinity;
  for (const r of data.results) {
    const sample = r.sample as { confidence?: number; explanation?: string };
    const score = (sample.confidence ?? 0) - (sample.explanation?.length ?? 0) / 1000;
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

**When to use custom pickers:**
- Your task has a clear selection heuristic (confidence, shortness, scoring rubric)
- You want to implement an LLM-judge selection
- For classification tasks, the built-in majority-vote default often works well

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

## Hyperparameter Tuning

MiPRO primarily optimizes program-level levers (instructions, few-shot demos). Model hyperparameters like `temperature` and `topP` can be included for practical gains.

### Temperature Tuning (Recommended)

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  sampleCount: 3, // Pairs well with temperature tuning
  // Temperature is tuned by default when using Python service
});
```

### Optional: Include topP

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  optimizeTopP: true, // Adds topP (0.7–1.0) to search space
  sampleCount: 3,
});
```

**Guidelines:**
- Prefer a small, impactful set (e.g., `temperature`, occasionally `topP`)
- Keep ranges conservative to avoid noisy evaluations
- Measure costs: a larger hyperparameter space increases trials

## Early Stopping and Minibatch

### Early Stopping

MiPRO will stop if no trial improves the best score by at least the threshold for the configured number of trials.

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  earlyStoppingTrials: 5,
  minImprovementThreshold: 0.01, // Stop if no 1% improvement in 5 trials
});
```

### Minibatch Scheduling

When `minibatch` is true, evaluations run on random minibatches. Every `minibatchFullEvalSteps` trials, MiPRO runs a full evaluation to correct drift.

```typescript
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples: largeExampleSet,
  minibatch: true,
  minibatchSize: 25,
  minibatchFullEvalSteps: 10, // Full eval every 10 trials
});
```

## Checkpointing

Long-running optimizations can be expensive. MiPRO provides checkpointing to save progress and recover from failures.

```typescript
import { type AxCheckpointSaveFn, type AxCheckpointLoadFn } from '@ax-llm/ax';

const checkpointSave: AxCheckpointSaveFn = async (checkpoint) => {
  const id = `checkpoint_${Date.now()}`;
  await fs.writeFile(`${id}.json`, JSON.stringify(checkpoint));
  return id;
};

const checkpointLoad: AxCheckpointLoadFn = async (id) => {
  try {
    return JSON.parse(await fs.readFile(`${id}.json`, 'utf8'));
  } catch {
    return null;
  }
};

const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  checkpointSave,
  checkpointLoad,
  checkpointInterval: 10, // Save every 10 rounds
  resumeFromCheckpoint: 'checkpoint_12345', // Resume from specific checkpoint
  options: { numTrials: 50, verbose: true }
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

### 2. Better Metrics = Better Optimization

❌ **Too simple**:
```typescript
const simpleMetric = ({ prediction, example }) => {
  return prediction.category === example.category ? 1 : 0;
};
```

✅ **More nuanced**:
```typescript
const betterMetric = ({ prediction, example }) => {
  let score = 0;

  // Main task (80% of score)
  if (prediction.category === example.category) {
    score += 0.8;
  }

  // Bonus for confidence (20% of score)
  if (prediction.confidence && prediction.confidence > 0.7) {
    score += 0.2;
  }

  return score;
};
```

### 3. Start Small, Then Scale

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

### 4. Control Costs

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

## See Also

- [OPTIMIZE.md](OPTIMIZE.md) - Main optimization guide
- [GEPA.md](GEPA.md) - Multi-objective optimization
- [ACE.md](ACE.md) - Agentic Context Engineering
- `src/examples/mipro-python-optimizer.ts` - Complete working example
