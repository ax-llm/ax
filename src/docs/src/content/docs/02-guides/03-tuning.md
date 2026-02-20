---
title: Advanced Prompt Tuning
description: Learn how to tune your prompts for better performance using Ax's optimization tools
---

# Advanced Prompt Tuning

Prompt tuning is the process of automatically improving your prompts to get better, more consistent results from language models. Ax provides multiple optimization methods to enhance your prompt performance, reduce token usage, and enable smaller models to produce higher-quality results.

This guide will cover:
- Why prompt tuning matters
- Basic tuning with `AxBootstrapFewShot`
- Advanced tuning with `AxMiPRO` (Model Instruction Program Optimization v2)
- How to apply tuned prompts to your applications
- Best practices for effective tuning

## Why Tune Your Prompts?

Prompt tuning offers several key benefits:

- **Improved accuracy**: Find optimal instructions and examples that help models understand your specific task
- **Reduced costs**: Optimize prompts to use fewer tokens or run effectively on smaller, less expensive models
- **Consistency**: Reduce variability in outputs by providing high-quality demonstrations
- **Domain adaptation**: Tailor general-purpose models to your specific domain with minimal effort

## Basic Tuning with AxBootstrapFewShot

The `AxBootstrapFewShot` optimizer is a straightforward way to improve your prompts through few-shot learning. It generates high-quality examples from your dataset that help the model better understand your task.

### How It Works

1. The optimizer takes your program and examples as input
2. It uses a larger model to generate demonstrations for a subset of examples
3. These demonstrations are evaluated using your metric function
4. The best demonstrations are selected and combined to create an optimized prompt

### Example: Optimizing a Question-Answering Prompt

```typescript
import {
  AxAI,
  AxChainOfThought,
  AxBootstrapFewShot,
  AxEvalUtil,
  AxHFDataLoader,
  type AxMetricFn
} from '@ax-llm/ax'

// 1. Load your dataset (using HuggingFace data loader)
const hf = new AxHFDataLoader({
  dataset: 'hotpot_qa',
  split: 'train'
})

const examples = await hf.getData<{ question: string; answer: string }>({
  count: 100,
  fields: ['question', 'answer']
})

// 2. Create your AI service
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
})

// 3. Setup the program you want to tune
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  `question -> answer "in short 2 or 3 words"`
)

// 4. Configure the optimizer
const optimizer = new AxBootstrapFewShot<
  { question: string },
  { answer: string }
>({
  ai,
  program,
  examples
})

// 5. Define your evaluation metric
const metricFn: AxMetricFn = ({ prediction, example }) =>
  AxEvalUtil.emScore(prediction.answer as string, example.answer as string)

// 6. Run the optimizer and save the results
const result = await optimizer.compile(metricFn)
const values = JSON.stringify(result, null, 2)
await fs.promises.writeFile('./tuned-demos.json', values)
```

### Using Your Tuned Prompt

After tuning, load and apply your optimized configuration. The recommended approach uses `applyOptimization()`:

```typescript
import fs from 'fs'
import { AxAI, AxChainOfThought, AxOptimizedProgramImpl } from '@ax-llm/ax'

// Load the AI service
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
})

// Create your program
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  `question -> answer "in short 2 or 3 words"`
)

// Load and apply the complete optimization (demos + instruction + model config)
const savedData = JSON.parse(
  await fs.promises.readFile('./tuned-optimization.json', 'utf8')
)
const optimizedProgram = new AxOptimizedProgramImpl(savedData)
program.applyOptimization(optimizedProgram)

// Use the optimized program
const result = await program.forward(ai, {
  question: 'What castle did David Gregory inherit?'
})
console.log(result) // Optimized answer
```

You can also apply demos directly using `setDemos()`. Each demo carries a `programId` that routes it to the correct program in a hierarchy:

```typescript
// Discover valid program IDs
console.log(program.namedPrograms())
// [{ id: 'root', signature: 'question -> answer' }]

// Apply demos by programId
program.setDemos([
  {
    programId: 'root',
    traces: [
      { question: 'Who wrote Hamlet?', answer: 'Shakespeare' },
      { question: 'Capital of France?', answer: 'Paris' },
    ],
  },
])
```

For multi-program hierarchies (agents with children, flows with nodes), `programId` uses dot-separated paths like `'root.actor'`. Use `namedPrograms()` to discover valid IDs. Unknown programIds throw a descriptive error at runtime, and TypeScript catches typos at compile time on `AxAgent` and `AxFlow`.

## Advanced Tuning with AxMiPRO v2

While `AxBootstrapFewShot` is powerful, `AxMiPRO` (Model Instruction Program Optimization v2) takes prompt tuning to the next level. This Bayesian optimization framework systematically explores different combinations of instructions, demonstrations, and examples to find the optimal configuration.

### Key Features of MiPRO v2

- **Instruction optimization**: Automatically generates and tests multiple instruction candidates
- **Few-shot example selection**: Finds optimal demonstrations from your dataset
- **Smart Bayesian optimization**: Efficiently explores the configuration space
- **Early stopping**: Halts optimization when improvements plateau to save compute
- **Program and data-aware**: Considers program structure and dataset characteristics

### Example: Sentiment Analysis Optimization

```typescript
import fs from 'node:fs'
import {
  AxAI,
  AxChainOfThought,
  AxMiPRO,
  type AxMetricFn
} from '@ax-llm/ax'

// 1. Create your training data
const trainingData = [
  { productReview: 'This product is amazing!', label: 'positive' },
  { productReview: 'Completely disappointed by the quality.', label: 'negative' },
  { productReview: 'Best purchase ever.', label: 'positive' },
  { productReview: 'I really hate how this turned out.', label: 'negative' },
  // Additional examples...
]

const validationData = [
  { productReview: 'Very happy with the results.', label: 'positive' },
  { productReview: 'Terrible experience, not recommended.', label: 'negative' },
  // Additional validation examples...
]

// 2. Setup AI service
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY
})

// 3. Create sentiment analysis program
const classifyProgram = new AxChainOfThought<
  { productReview: string },
  { label: string }
>(`productReview -> label:string "positive" or "negative"`)

// 4. Configure MiPRO optimizer
const optimizer = new AxMiPRO({
  ai,
  program: classifyProgram,
  examples: trainingData,
  options: {
    numCandidates: 3,       // Number of instruction candidates
    numTrials: 10,          // Number of optimization trials
    maxBootstrappedDemos: 2, // Maximum demos to bootstrap
    maxLabeledDemos: 3,     // Maximum labeled examples
    earlyStoppingTrials: 3, // Stop after 3 trials with no improvement
    programAwareProposer: true,
    dataAwareProposer: true,
    verbose: true
  }
})

// 5. Define evaluation metric
const metricFn: AxMetricFn = ({ prediction, example }) => {
  return prediction.label === example.label
}

// 6. Run the optimization
const optimizedProgram = await optimizer.compile(metricFn, {
  valset: validationData,
  auto: 'medium'  // Balanced optimization level
})

// 7. Save the optimized configuration
const programConfig = JSON.stringify(optimizedProgram, null, 2)
await fs.promises.writeFile('./mipro-optimized-config.json', programConfig)
```

### MiPRO Configuration Options

MiPRO v2 offers extensive configuration options to tailor the optimization process:

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

For convenience, MiPRO offers pre-configured optimization intensities using the `auto` parameter:

```typescript
// 1. Light optimization (faster, less thorough)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'light' })

// 2. Medium optimization (balanced)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'medium' })

// 3. Heavy optimization (slower, more thorough)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'heavy' })
```

## How MiPRO v2 Works

MiPRO v2 optimizes your prompts through a systematic process:

1. **Instruction Generation**: Creates multiple candidate instructions based on program structure and dataset characteristics
2. **Few-Shot Bootstrapping**: Generates high-quality example demonstrations from your data
3. **Example Selection**: Strategically selects labeled examples from your dataset
4. **Bayesian Optimization**: Systematically explores different combinations of instructions and examples
5. **Configuration Application**: Applies the best-performing configuration to your program

This process finds the optimal balance of instructions and examples to maximize your model's effectiveness for your specific task.

## Best Practices for Prompt Tuning

### 1. Prepare Quality Training Data

- **Diversity**: Include examples covering different aspects of your task
- **Balance**: Ensure balanced representation of different classes or categories
- **Size**: Aim for at least 20-100 examples for basic tuning, more for complex tasks
- **Quality**: Manually review examples to ensure they're correct and representative

### 2. Choose the Right Evaluation Metric

Select a metric that truly measures success for your task:

- **Classification**: Accuracy, F1 score, or precision/recall
- **Generation**: BLEU, ROUGE, or semantic similarity scores
- **Question Answering**: Exact match (EM) or F1 scores
- **Custom Metrics**: Design task-specific metrics when standard ones don't apply

### 3. Balance Compute and Quality

- For quick improvements, use `AxBootstrapFewShot` with fewer examples
- For production-critical applications, use `AxMiPRO` with the "heavy" optimization level
- Consider running optimization overnight for complex tasks
- Save and version your optimized configurations for reuse

### 4. Test on Diverse Validation Sets

- Always test your tuned programs on held-out validation data
- Ensure validation examples are representative of real-world use cases
- Compare optimized vs. unoptimized performance to measure improvement

## Conclusion

Prompt tuning is a powerful technique to improve the performance of your language model applications. Ax provides both simple and advanced optimization tools that can significantly enhance your results while potentially reducing costs.

Start with `AxBootstrapFewShot` for quick improvements, then explore `AxMiPRO` for more comprehensive optimization. By following the best practices outlined in this guide, you'll be able to create prompts that maximize the effectiveness of your language models for your specific tasks.
