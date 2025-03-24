---
title: Prompt Tuning MiPRO v2
description: MiPRO v2 is an advanced prompt optimization framework that uses Bayesian optimization to automatically find the best instructions, demonstrations, and examples for your LLM programs.
---

MiPRO v2 is an advanced prompt optimization framework that uses Bayesian optimization to automatically find the best instructions, demonstrations, and examples for your LLM programs. By systematically exploring different prompt configurations, MiPRO v2 helps maximize model performance without manual tuning.


### Key Features

- **Instruction optimization**: Automatically generates and tests multiple instruction candidates
- **Few-shot example selection**: Finds optimal demonstrations from your dataset
- **Smart Bayesian optimization**: Uses UCB (Upper Confidence Bound) strategy to efficiently explore configurations
- **Early stopping**: Stops optimization when improvements plateau to save compute
- **Program and data-aware**: Considers program structure and dataset characteristics

### Basic Usage

```typescript
import { AxAI, AxChainOfThought, AxMiPRO } from '@ax-llm/ax'

// 1. Setup your AI service
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY
})

// 2. Create your program
const program = new AxChainOfThought(`input -> output`)

// 3. Configure the optimizer
const optimizer = new AxMiPRO({
  ai,
  program,
  examples: trainingData, // Your training examples
  options: {
    numTrials: 20,  // Number of configurations to try
    auto: 'medium'  // Optimization level
  }
})

// 4. Define your evaluation metric
const metricFn = ({ prediction, example }) => {
  return prediction.output === example.output
}

// 5. Run the optimization
const optimizedProgram = await optimizer.compile(metricFn, {
  valset: validationData  // Optional validation set
})

// 6. Use the optimized program
const result = await optimizedProgram.forward(ai, { input: "test input" })
```

### Configuration Options

MiPRO v2 provides extensive configuration options:

| Option | Description | Default |
|--------|-------------|---------|
| `numCandidates` | Number of instruction candidates to generate | 5 |
| `numTrials` | Number of optimization trials | 30 |
| `maxBootstrappedDemos` | Maximum number of bootstrapped demonstrations | 3 |
| `maxLabeledDemos` | Maximum number of labeled examples | 4 |
| `minibatch` | Use minibatching for faster evaluation | true |
| `minibatchSize` | Size of evaluation minibatches | 25 |
| `earlyStoppingTrials` | Stop if no improvement after N trials | 5 |
| `minImprovementThreshold` | Minimum score improvement threshold | 0.01 |
| `programAwareProposer` | Use program structure for better proposals | true |
| `dataAwareProposer` | Consider dataset characteristics | true |
| `verbose` | Show detailed optimization progress | false |

### Optimization Levels

You can quickly configure optimization intensity with the `auto` parameter:

```typescript
// Light optimization (faster, less thorough)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'light' })

// Medium optimization (balanced)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'medium' })

// Heavy optimization (slower, more thorough)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'heavy' })
```

### Advanced Example: Sentiment Analysis

```typescript
// Create sentiment analysis program
const classifyProgram = new AxChainOfThought<
  { productReview: string },
  { label: string }
>(`productReview -> label:string "positive" or "negative"`)

// Configure optimizer with advanced settings
const optimizer = new AxMiPRO({
  ai,
  program: classifyProgram,
  examples: trainingData,
  options: {
    numCandidates: 3,
    numTrials: 10,
    maxBootstrappedDemos: 2,
    maxLabeledDemos: 3,
    earlyStoppingTrials: 3,
    programAwareProposer: true,
    dataAwareProposer: true,
    verbose: true
  }
})

// Run optimization and save the result
const optimizedProgram = await optimizer.compile(metricFn, {
  valset: validationData
})

// Save configuration for future use
const programConfig = JSON.stringify(optimizedProgram, null, 2)
await fs.promises.writeFile('./optimized-config.json', programConfig)
```

### How It Works

MiPRO v2 works through these steps:
1. Generates various instruction candidates
2. Bootstraps few-shot examples from your data
3. Selects labeled examples directly from your dataset
4. Uses Bayesian optimization to find the optimal combination
5. Applies the best configuration to your program

By exploring the space of possible prompt configurations and systematically measuring performance, MiPRO v2 delivers optimized prompts that maximize your model's effectiveness.