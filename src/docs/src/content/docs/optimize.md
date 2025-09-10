---
title: "Optimization Guide"
description: "LLM Optimization Made Simple: A Beginner's Guide to Ax"
---

# LLM Optimization Made Simple: A Beginner's Guide to Ax

**Goal**: Learn how to make your AI programs smarter, faster, and cheaper
through automatic optimization. **Time to first results**: 5 minutes

## 📋 Table of Contents

- [What is LLM Optimization?](#what-is-llm-optimization)
- [🚀 5-Minute Quick Start](#-5-minute-quick-start) ← **Start here!**
  - [Step 6: Save Your Optimization Results 💾](#step-6-save-your-optimization-results-)
  - [Step 7: Load and Use in Production 🚀](#step-7-load-and-use-in-production-)
- [📚 Understanding the Basics](#-understanding-the-basics)
- [🎯 Common Use Cases](#-common-use-cases-copy--paste-ready)
- [💰 Saving Money: Teacher-Student Setup](#-saving-money-teacher-student-setup)
- [🔧 Making It Better: Practical Tips](#-making-it-better-practical-tips)
- [🛠️ Troubleshooting Guide](#️-troubleshooting-guide)
- [🎓 Next Steps: Level Up Your Skills](#-next-steps-level-up-your-skills)
- [📖 Complete Working Example](#-complete-working-example)
- [🎯 Key Takeaways](#-key-takeaways)

---

## What is LLM Optimization?

Think of optimization like having a writing tutor for your AI. Instead of
manually tweaking prompts and examples, Ax automatically:

- **Writes better prompts** for your AI programs
- **Picks the best examples** to show your AI what you want
- **Saves you money** by making cheaper models work as well as expensive ones
- **Improves accuracy** without you having to be a prompt engineering expert

**Real example**: A sentiment analysis that goes from 70% accuracy to 90%
accuracy automatically, while reducing costs by 80%.

---

### Step 1: Install and Setup

```bash
npm install @ax-llm/ax
```

```typescript
// Create a .env file with your OpenAI API key
// OPENAI_APIKEY=your_key_here

import { ai, ax, AxMiPRO } from "@ax-llm/ax";
```

**Important**: Ax optimizers depend on a Python optimization service (Optuna).
For MiPRO v2 and production-scale optimization, you must start the Python
service before running any optimization. See "Python Optimization Service
Integration" below. Quick start:

```bash
cd src/optimizer
uv sync
uv run ax-optimizer server start --debug
```

### Step 2: Create Your First Optimizable Program

```typescript
// This is a simple sentiment analyzer - we'll make it smarter!
const sentimentAnalyzer = ax(
  'reviewText:string "Customer review" -> sentiment:class "positive, negative, neutral" "How the customer feels"',
);

// Set up your AI
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" }, // Start with the cheaper model
});
```

### Step 3: Provide Training Examples

```typescript
// Just 3-5 examples are enough to start!
const examples = [
  { reviewText: "I love this product!", sentiment: "positive" },
  { reviewText: "This is terrible quality", sentiment: "negative" },
  { reviewText: "It works fine, nothing special", sentiment: "neutral" },
  { reviewText: "Best purchase ever!", sentiment: "positive" },
  { reviewText: "Waste of money", sentiment: "negative" },
];
```

### Step 4: Define Success (Your Metric)

```typescript
// This tells the optimizer what "good" looks like
const metric = ({ prediction, example }) => {
  // Simple: 1 point for correct answer, 0 for wrong
  return prediction.sentiment === example.sentiment ? 1 : 0;
};
```

### Step 5: Run the Magic ✨

```typescript
// Create the optimizer
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  options: { verbose: true }, // Show progress
});

// Let it optimize (takes 1-2 minutes)
console.log("🔄 Optimizing your AI program...");
const result = await optimizer.compile(sentimentAnalyzer, examples, metric);

// Apply the improvements
if (result.demos) {
  sentimentAnalyzer.setDemos(result.demos);
}

console.log(
  `✅ Done! Improved from baseline to ${result.bestScore * 100}% accuracy`,
);
```

### Step 6: Save Your Optimization Results 💾

**This is crucial for production!** The new unified `AxOptimizedProgram`
contains everything needed to reproduce your optimization:

```typescript
import { promises as fs } from "fs";

// Apply the optimized configuration using the unified approach
if (result.optimizedProgram) {
  // Apply all optimizations in one clean call
  sentimentAnalyzer.applyOptimization(result.optimizedProgram);

  console.log(`✨ Applied optimized configuration:`);
  console.log(`   Score: ${result.optimizedProgram.bestScore.toFixed(3)}`);
  console.log(`   Optimizer: ${result.optimizedProgram.optimizerType}`);
  console.log(
    `   Converged: ${result.optimizedProgram.converged ? "✅" : "❌"}`,
  );

  // Save the complete optimization result
  await fs.writeFile(
    "sentiment-analyzer-optimization.json",
    JSON.stringify(
      {
        version: "2.0",
        bestScore: result.optimizedProgram.bestScore,
        instruction: result.optimizedProgram.instruction,
        demos: result.optimizedProgram.demos,
        modelConfig: result.optimizedProgram.modelConfig,
        optimizerType: result.optimizedProgram.optimizerType,
        optimizationTime: result.optimizedProgram.optimizationTime,
        totalRounds: result.optimizedProgram.totalRounds,
        converged: result.optimizedProgram.converged,
        stats: result.optimizedProgram.stats,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "✅ Complete optimization saved to sentiment-analyzer-optimization.json",
  );
}

// What you just saved:
console.log("Saved data contains:");
console.log("- Optimized few-shot examples (demos)");
console.log("- Optimized instruction prompts");
console.log("- Model configuration (temperature, etc.)");
console.log("- Complete performance metrics");
console.log("- Optimization metadata and timing");
console.log(`- Performance score: ${result.bestScore}`);
```

### Step 7: Load and Use in Production 🚀

In your production code, recreate and apply the saved optimization:

```typescript
import { AxOptimizedProgramImpl } from "@ax-llm/ax";

// Production app - load pre-optimized configuration
const sentimentAnalyzer = ax(
  'reviewText:string "Customer review" -> sentiment:class "positive, negative, neutral" "How the customer feels"',
);

// Load the saved optimization results
const savedData = JSON.parse(
  await fs.readFile("sentiment-analyzer-optimization.json", "utf8"),
);

// Recreate the optimized program
const optimizedProgram = new AxOptimizedProgramImpl({
  bestScore: savedData.bestScore,
  stats: savedData.stats,
  instruction: savedData.instruction,
  demos: savedData.demos,
  modelConfig: savedData.modelConfig,
  optimizerType: savedData.optimizerType,
  optimizationTime: savedData.optimizationTime,
  totalRounds: savedData.totalRounds,
  converged: savedData.converged,
});

// Apply the complete optimization (demos, instruction, model config, etc.)
sentimentAnalyzer.applyOptimization(optimizedProgram);

console.log(`🚀 Loaded optimization v${savedData.version}`);
console.log(`   Score: ${optimizedProgram.bestScore.toFixed(3)}`);
console.log(`   Optimizer: ${optimizedProgram.optimizerType}`);

// Now your AI performs at the optimized level
const analysis = await sentimentAnalyzer.forward(llm, {
  reviewText: "The product arrived quickly but the quality was disappointing",
});

console.log("Analysis:", analysis.sentiment); // Much more accurate!
```

### Step 8: Understanding What You Get 📊

The new unified optimization result provides comprehensive information in one
object:

```typescript
const result = await optimizer.compile(sentimentAnalyzer, examples, metric);

// New unified approach - everything in one place:
if (result.optimizedProgram) {
  console.log({
    // Performance metrics
    bestScore: result.optimizedProgram.bestScore, // Best performance (0-1)
    converged: result.optimizedProgram.converged, // Did optimization converge?
    totalRounds: result.optimizedProgram.totalRounds, // Number of optimization rounds
    optimizationTime: result.optimizedProgram.optimizationTime, // Time taken (ms)

    // Program configuration
    instruction: result.optimizedProgram.instruction, // Optimized prompt
    demos: result.optimizedProgram.demos?.length, // Number of few-shot examples
    modelConfig: result.optimizedProgram.modelConfig, // Model settings (temperature, etc.)

    // Optimization metadata
    optimizerType: result.optimizedProgram.optimizerType, // Which optimizer was used
    stats: result.optimizedProgram.stats, // Detailed statistics
  });
}

// The unified result contains everything:
// - Optimized few-shot examples (demos)
// - Optimized instruction text
// - Model configuration (temperature, maxTokens, etc.)
// - Complete performance statistics
// - Optimization metadata (type, time, convergence)
// - Everything needed to reproduce the performance
```

### Step 9: Production Best Practices 📁

**File Organization:**

```
your-app/
├── optimizations/
│   ├── sentiment-analyzer-v2.0.json      ← Complete optimization (new format)
│   ├── email-classifier-v2.0.json        ← Different task
│   └── product-reviewer-v2.0.json        ← Another task
├── legacy-optimizations/
│   ├── sentiment-analyzer-demos.json     ← Legacy demos (v1.0 format)
│   └── email-classifier-demos.json       ← Old format
├── src/
│   ├── train-models.ts                    ← Training script
│   └── production-app.ts                  ← Production app
```

**Environment-specific Loading:**

```typescript
import { AxOptimizedProgramImpl } from "@ax-llm/ax";

// Load different optimizations for different environments
const optimizationFile = process.env.NODE_ENV === "production"
  ? "optimizations/sentiment-analyzer-prod-v2.0.json"
  : "optimizations/sentiment-analyzer-dev-v2.0.json";

const savedData = JSON.parse(await fs.readFile(optimizationFile, "utf8"));

// Handle both new unified format and legacy format
if (savedData.version === "2.0") {
  // New unified format
  const optimizedProgram = new AxOptimizedProgramImpl(savedData);
  sentimentAnalyzer.applyOptimization(optimizedProgram);
  console.log(`🚀 Loaded unified optimization v${savedData.version}`);
} else {
  // Legacy format (backward compatibility)
  sentimentAnalyzer.setDemos(savedData.demos || savedData);
  console.log("⚠️  Loaded legacy demo format - consider upgrading");
}
```

**Version Your Optimizations:**

```typescript
// The new format includes comprehensive versioning by default
const optimizationData = {
  version: "2.0", // Format version
  modelVersion: "1.3.0", // Your model version
  created: new Date().toISOString(),
  bestScore: result.optimizedProgram.bestScore,
  instruction: result.optimizedProgram.instruction,
  demos: result.optimizedProgram.demos,
  modelConfig: result.optimizedProgram.modelConfig,
  optimizerType: result.optimizedProgram.optimizerType,
  optimizationTime: result.optimizedProgram.optimizationTime,
  totalRounds: result.optimizedProgram.totalRounds,
  converged: result.optimizedProgram.converged,
  stats: result.optimizedProgram.stats,
  environment: process.env.NODE_ENV || "development",
  modelUsed: "gpt-4o-mini",
  trainingDataSize: examples.length,
};

await fs.writeFile(
  "sentiment-analyzer-v1.3.0.json",
  JSON.stringify(optimizationData, null, 2),
);
```

**🎉 Congratulations!** You now understand the complete unified optimization
workflow:

1. **Train** with examples and metrics
2. **Apply** optimization using
   `program.applyOptimization(result.optimizedProgram)`
3. **Save** the complete optimization configuration (demos + instruction + model
   config)
4. **Load** and recreate optimization in production using
   `AxOptimizedProgramImpl`
5. **Version** and manage your optimizations with comprehensive metadata

---

## 📚 Understanding the Basics

### What Just Happened?

1. **The Optimizer** tried different ways to ask your AI the question
2. **It tested** each approach using your examples
3. **It kept** the best-performing version
4. **Your program** now uses the optimized prompt and examples

### Key Terms (Simple Explanations)

- **Student AI**: The model you want to optimize (usually cheaper/faster)
- **Teacher AI**: Optional expensive model that helps create better instructions
- **Examples**: Your training data showing correct answers
- **Metric**: How you measure if the AI is doing well
- **Demos**: The best examples the optimizer found to show your AI

### What Does Optimization Actually Produce? 🎯

**The main output is DEMOS** - these are not just "demo data" but **optimized
few-shot examples** that dramatically improve your AI's performance:

```typescript
// What demos contain:
{
  "traces": [
    {
      "reviewText": "I love this product!",     // Input that works well
      "sentiment": "positive"                   // Expected output
    },
    {
      "reviewText": "This is terrible quality", // Another good example
      "sentiment": "negative"                   // Expected output
    }
  ],
  "instruction": "Analyze customer sentiment..." // Optimized prompt (MiPRO)
}
```

**Why demos are powerful:**

- ✅ **Portable**: Save as JSON, load anywhere
- ✅ **Fast**: No re-optimization in production
- ✅ **Effective**: Often 2-5x performance improvement
- ✅ **Cost-effective**: Reduce API calls by using cheaper models better

**The workflow:**

1. **Training**: `optimizer.compile()` → produces `result.demos`
2. **Save**: `JSON.stringify(result.demos)` → save to file/database
3. **Production**: Load demos → `program.setDemos(demos)` → improved performance

### When to Use Optimization

> **🎯 Perfect for beginners**: Start with classification tasks like sentiment
> analysis, email categorization, or content moderation where you have clear
> right/wrong answers.

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

---

## 🎯 Common Use Cases (Copy & Paste Ready)

### 1. Email Classification

```typescript
const emailClassifier = ax(`
  emailContent:string "Email text" -> 
  category:class "urgent, normal, spam" "Email priority",
  needsReply:class "yes, no" "Does this need a response?"
`);

const examples = [
  {
    emailContent: "URGENT: Server is down!",
    category: "urgent",
    needsReply: "yes",
  },
  {
    emailContent: "Thanks for your help yesterday",
    category: "normal",
    needsReply: "no",
  },
  {
    emailContent: "You won a million dollars! Click here!",
    category: "spam",
    needsReply: "no",
  },
];

const metric = ({ prediction, example }) => {
  let score = 0;
  if (prediction.category === example.category) score += 0.7;
  if (prediction.needsReply === example.needsReply) score += 0.3;
  return score;
};

// Same optimization pattern as before...
```

### 2. Customer Support Routing

```typescript
const supportRouter = ax(`
  customerMessage:string "Customer inquiry" -> 
  department:class "billing, technical, general" "Which team should handle this",
  urgency:class "low, medium, high" "How urgent is this"
`);

const examples = [
  {
    customerMessage: "I was charged twice for my subscription",
    department: "billing",
    urgency: "high",
  },
  {
    customerMessage: "How do I reset my password?",
    department: "technical",
    urgency: "medium",
  },
  {
    customerMessage: "What are your business hours?",
    department: "general",
    urgency: "low",
  },
];
```

### 3. Content Moderation

```typescript
const contentModerator = ax(`
  userPost:string "User-generated content" -> 
  safe:class "yes, no" "Is this content appropriate?",
  reason:string "Why was this flagged (if unsafe)"
`);

const examples = [
  { userPost: "Great weather today!", safe: "yes", reason: "" },
  {
    userPost: "This product sucks and so do you!",
    safe: "no",
    reason: "Inappropriate language",
  },
  { userPost: "Check out my new blog post", safe: "yes", reason: "" },
];
```

---

## 💰 Saving Money: Teacher-Student Setup

**The Problem**: GPT-4 is smart but expensive. GPT-4-mini is cheap but sometimes
not as accurate.

**The Solution**: Use GPT-4 as a "teacher" to make GPT-4-mini as smart as GPT-4,
but at 1/10th the cost!

### Simple Teacher-Student Setup

```typescript
// Teacher: Smart but expensive (only used during optimization)
const teacherAI = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o" }, // The expensive one
});

// Student: Fast and cheap (used for actual work)
const studentAI = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" }, // The cheap one
});

const optimizer = new AxMiPRO({
  studentAI, // This is what gets optimized
  teacherAI, // This helps create better instructions
  examples,
  options: { verbose: true },
});

// The magic: cheap model performs like expensive model!
const result = await optimizer.compile(program, examples, metric);
```

**Real savings**: Instead of paying $0.03 per 1K tokens, you pay $0.0006 per 1K
tokens after optimization - that's 50x cheaper!

---

## 🔧 Making It Better: Practical Tips

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
  examples: examples.slice(0, 10), // Just first 10
  options: {
    numTrials: 3, // Quick test
    verbose: true,
  },
});
```

**Phase 2**: Scale up if results are good

```typescript
const optimizer = new AxMiPRO({
  studentAI,
  teacherAI,
  examples: allExamples, // All your data
  options: {
    numTrials: 8, // More thorough
    verbose: true,
  },
});
```

---

## 🛠️ Troubleshooting Guide

### "My optimization score is low!"

**Check your examples**:

```typescript
// Are they diverse enough?
console.log("Unique categories:", [
  ...new Set(examples.map((e) => e.category)),
]);

// Are they correct?
examples.forEach((ex, i) => {
  console.log(`Example ${i}: ${ex.text} -> ${ex.category}`);
});
```

**Try a better metric**:

```typescript
// Add logging to see what's happening
const debugMetric = ({ prediction, example }) => {
  const correct = prediction.category === example.category;
  console.log(
    `Predicted: ${prediction.category}, Expected: ${example.category}, Correct: ${correct}`,
  );
  return correct ? 1 : 0;
};
```

### "It's too expensive!"

**Set a budget**:

```typescript
import { AxDefaultCostTracker } from "@ax-llm/ax";

const costTracker = new AxDefaultCostTracker({
  maxTokens: 10000, // Stop after 10K tokens
  maxCost: 5, // Stop after $5
});

const optimizer = new AxMiPRO({
  studentAI,
  examples,
  costTracker, // Automatic budget control
  options: {
    numTrials: 3, // Fewer trials
    earlyStoppingTrials: 2, // Stop early if no improvement
  },
});
```

### "It's taking too long!"

**Speed it up**:

```typescript
const optimizer = new AxMiPRO({
  studentAI,
  examples: examples.slice(0, 20), // Fewer examples
  options: {
    numCandidates: 3, // Fewer candidates to try
    numTrials: 5, // Fewer trials
    minibatch: true, // Process in smaller batches
    verbose: true,
  },
});
```

### "Results are inconsistent!"

**Make it reproducible**:

```typescript
const optimizer = new AxMiPRO({
  studentAI: ai({
    name: "openai",
    apiKey: process.env.OPENAI_APIKEY!,
    config: {
      model: "gpt-4o-mini",
      temperature: 0.1, // Lower = more consistent
    },
  }),
  examples,
  seed: 42, // Same results every time
  options: { verbose: true },
});
```

---

## 🎓 Next Steps: Level Up Your Skills

### 1. Try Different Optimizers

**For few-shot learning** (when you have good examples):

```typescript
import { AxBootstrapFewShot } from "@ax-llm/ax";

const optimizer = new AxBootstrapFewShot({
  studentAI,
  examples,
  options: {
    maxDemos: 5, // Show 5 examples to AI
    maxRounds: 3, // 3 rounds of improvement
    verboseMode: true,
  },
});
```

### 2. Multi-Objective Optimization (GEPA uses `compile`; MiPRO uses `compilePareto`)

**The Problem**: Sometimes you care about multiple things at once - accuracy AND
speed AND cost. Traditional optimization only handles one objective at a time.

**The Solution**: `compilePareto` finds the optimal trade-offs between multiple
objectives using Pareto frontier analysis.

#### What is Pareto Optimization?

A solution is "Pareto optimal" if you can't improve one objective without making
another objective worse. The collection of all such solutions is called the
"Pareto frontier."

**Example**:

- Solution A: 90% accuracy, 100ms response time, $0.10 cost
- Solution B: 85% accuracy, 50ms response time, $0.05 cost
- Solution C: 80% accuracy, 200ms response time, $0.08 cost

Solutions A and B are both Pareto optimal (A is more accurate but
slower/expensive, B is faster/cheaper but less accurate). Solution C is
dominated by both A and B.

#### When to Use `compilePareto`

✅ **Perfect for:**

- Content moderation (accuracy vs speed vs cost)
- Customer service routing (response time vs routing accuracy vs resource usage)
- Email classification (precision vs recall vs processing speed)
- Product recommendations (relevance vs diversity vs computation cost)

❌ **Skip for:**

- Single clear objective (use regular `compile`)
- When one objective is clearly most important
- Quick prototyping (more complex than single-objective)

#### Complete Working Example

```typescript
import { ai, ax, AxMiPRO } from "@ax-llm/ax";

// Content moderation with multiple objectives
const contentModerator = ax(`
  userPost:string "User-generated content" ->
  isSafe:class "safe, unsafe" "Content safety",
  confidence:number "Confidence 0-1",
  reason:string "Explanation if unsafe"
`);

// Training examples
const examples = [
  {
    userPost: "Great weather today!",
    isSafe: "safe",
    confidence: 0.95,
    reason: "",
  },
  {
    userPost: "This product sucks and the company is terrible!",
    isSafe: "unsafe",
    confidence: 0.8,
    reason: "Aggressive language",
  },
  // ... more examples
];

// Multi-objective metric function
const multiMetric = ({ prediction, example }) => {
  // Calculate multiple scores
  const accuracy = prediction.isSafe === example.isSafe ? 1 : 0;

  // Reward high confidence when correct, penalize when wrong
  const confidenceScore = prediction.isSafe === example.isSafe
    ? (prediction.confidence || 0)
    : (1 - (prediction.confidence || 0));

  // Reward explanations for unsafe content
  const explanationScore = example.isSafe === "unsafe"
    ? (prediction.reason && prediction.reason.length > 10 ? 1 : 0)
    : 1; // No penalty for safe content

  // Return multiple objectives
  return {
    accuracy, // Correctness of safety classification
    confidence: confidenceScore, // Quality of confidence calibration
    explanation: explanationScore, // Quality of reasoning
  };
};

// Set up optimizer
const optimizer = new AxMiPRO({
  studentAI: ai({
    name: "openai",
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: "gpt-4o-mini" },
  }),
  examples,
  options: { verbose: true },
});

// Run multi-objective optimization
console.log("🔄 Finding optimal trade-offs...");
const result = await optimizer.compilePareto(
  contentModerator,
  examples,
  multiMetric,
);

console.log(`✅ Found ${result.paretoFrontSize} optimal solutions!`);
console.log(`📊 Hypervolume: ${result.hypervolume?.toFixed(4) || "N/A"}`);

// Explore the Pareto frontier
result.paretoFront.forEach((solution, index) => {
  console.log(`\n🎯 Solution ${index + 1}:`);
  console.log(`  Accuracy: ${(solution.scores.accuracy * 100).toFixed(1)}%`);
  console.log(
    `  Confidence: ${(solution.scores.confidence * 100).toFixed(1)}%`,
  );
  console.log(
    `  Explanation: ${(solution.scores.explanation * 100).toFixed(1)}%`,
  );
  console.log(`  Strategy: ${solution.configuration.strategy}`);
  console.log(`  Dominates: ${solution.dominatedSolutions} other solutions`);
});
```

#### Choosing the Best Solution

```typescript
// Option 1: Pick the solution that dominates the most others
const mostDominant = result.paretoFront.reduce((best, current) =>
  current.dominatedSolutions > best.dominatedSolutions ? current : best
);

// Option 2: Pick based on your priorities (weighted combination)
const priorities = { accuracy: 0.6, confidence: 0.3, explanation: 0.1 };
const bestWeighted = result.paretoFront.reduce((best, current) => {
  const currentScore = Object.entries(current.scores)
    .reduce((sum, [obj, score]) => sum + score * (priorities[obj] || 0), 0);
  const bestScore = Object.entries(best.scores)
    .reduce((sum, [obj, score]) => sum + score * (priorities[obj] || 0), 0);
  return currentScore > bestScore ? current : best;
});

// Option 3: Interactive selection based on business requirements
const businessOptimal = result.paretoFront.find((solution) =>
  solution.scores.accuracy >= 0.85 && // Must be at least 85% accurate
  solution.scores.confidence >= 0.7 && // Must be well-calibrated
  solution.scores.explanation >= 0.8 // Must explain unsafe content well
);

// Apply the chosen solution
if (businessOptimal?.demos) {
  contentModerator.setDemos(businessOptimal.demos);
  console.log("🎯 Applied business-optimal solution");
}
```

#### Advanced Multi-Objective Patterns

**Cost-Quality Trade-off**:

```typescript
const multiMetric = ({ prediction, example }) => ({
  accuracy: prediction.category === example.category ? 1 : 0,
  cost: 1 / (estimateTokenCost(prediction) + 1), // Inverse cost (higher = cheaper)
  speed: 1 / (prediction.responseTime || 1000), // Inverse time (higher = faster)
});
```

**Precision-Recall Optimization**:

```typescript
const multiMetric = ({ prediction, example }) => {
  const truePositive =
    prediction.category === "positive" && example.category === "positive"
      ? 1
      : 0;
  const falsePositive =
    prediction.category === "positive" && example.category !== "positive"
      ? 1
      : 0;
  const falseNegative =
    prediction.category !== "positive" && example.category === "positive"
      ? 1
      : 0;

  return {
    precision: falsePositive === 0
      ? 1
      : (truePositive / (truePositive + falsePositive)),
    recall: falseNegative === 0
      ? 1
      : (truePositive / (truePositive + falseNegative)),
  };
};
```

**Customer Satisfaction vs Efficiency**:

```typescript
const multiMetric = ({ prediction, example }) => ({
  customerSatisfaction: calculateSatisfactionScore(prediction, example),
  resourceEfficiency: 1 / (prediction.processingSteps || 1),
  resolutionSpeed: prediction.resolutionTime
    ? (1 / prediction.resolutionTime)
    : 0,
});
```

#### Understanding the Results

```typescript
const result = await optimizer.compilePareto(program, multiMetric);

// Key properties of AxParetoResult:
console.log(`Pareto frontier size: ${result.paretoFrontSize}`);
console.log(
  `Total solutions generated: ${result.finalConfiguration?.numSolutions}`,
);
console.log(`Best single score: ${result.bestScore}`);
console.log(`Hypervolume (2D only): ${result.hypervolume}`);

// Each solution on the frontier contains:
result.paretoFront.forEach((solution) => {
  solution.demos; // Optimized examples for this solution
  solution.scores; // Scores for each objective
  solution.configuration; // How this solution was generated
  solution.dominatedSolutions; // How many other solutions this beats
});
```

#### Performance Considerations

- **Runtime**: `compilePareto` runs multiple single-objective optimizations, so
  it takes 3-10x longer than regular `compile`
- **Cost**: Uses more API calls due to multiple optimization runs
- **Complexity**: Only use when you genuinely need multiple objectives
- **Scalability**: Works best with 2-4 objectives; more objectives =
  exponentially more solutions

#### Tips for Success

1. **Start with 2-3 objectives**: More objectives make it harder to choose
   solutions
2. **Make objectives independent**: Avoid highly correlated objectives
3. **Scale objectives similarly**: Ensure all objectives range 0-1 for fair
   comparison
4. **Use business constraints**: Filter the Pareto frontier by minimum
   requirements
5. **Validate solutions**: Test multiple Pareto-optimal solutions in practice

### 3. Chain Multiple Programs

```typescript
// First program: Extract key info
const extractor = ax(
  'emailContent:string "Email content" -> keyPoints:string[] "Important points"',
);

// Second program: Classify based on extracted info
const classifier = ax(
  'keyPoints:string[] "Key points" -> priority:class "low, medium, high" "Email priority"',
);

// Optimize them separately, then chain them
const extractResult = await extractOptimizer.compile(
  extractor,
  extractExamples,
  extractMetric,
);
const classifyResult = await classifyOptimizer.compile(
  classifier,
  classifyExamples,
  classifyMetric,
);

// Use them together
const emailContent = "Meeting moved to 3pm tomorrow, please confirm";
const keyPoints = await extractor.forward(llm, { emailContent });
const priority = await classifier.forward(llm, {
  keyPoints: keyPoints.keyPoints,
});
```

---

## 📖 Complete Working Example

Here's a full example you can copy, paste, and run:

```typescript
import { ai, ax, AxMiPRO } from "@ax-llm/ax";

// 1. Define the task
const productReviewer = ax(`
  productReview:string "Customer product review" -> 
  rating:class "1, 2, 3, 4, 5" "Star rating 1-5",
  aspect:class "quality, price, shipping, service" "Main concern",
  recommendation:class "buy, avoid, maybe" "Would you recommend?"
`);

// 2. Training examples
const examples = [
  {
    productReview: "Amazing quality, worth every penny!",
    rating: "5",
    aspect: "quality",
    recommendation: "buy",
  },
  {
    productReview: "Too expensive for what you get",
    rating: "2",
    aspect: "price",
    recommendation: "avoid",
  },
  {
    productReview: "Good product but took forever to arrive",
    rating: "3",
    aspect: "shipping",
    recommendation: "maybe",
  },
  {
    productReview: "Great value, fast delivery, happy customer!",
    rating: "5",
    aspect: "price",
    recommendation: "buy",
  },
  {
    productReview: "Customer service was rude when I had issues",
    rating: "1",
    aspect: "service",
    recommendation: "avoid",
  },
];

// 3. AI setup
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" },
});

// 4. Success metric
const metric = ({ prediction, example }) => {
  let score = 0;
  if (prediction.rating === example.rating) score += 0.5;
  if (prediction.aspect === example.aspect) score += 0.3;
  if (prediction.recommendation === example.recommendation) score += 0.2;
  return score;
};

// 5. Optimize
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  options: { verbose: true },
});

console.log("🔄 Starting optimization...");
const result = await optimizer.compile(productReviewer, examples, metric);

console.log(
  `✅ Optimization complete! Score improved to ${
    (result.bestScore * 100).toFixed(1)
  }%`,
);

// 6. Apply and save the optimization results using the unified approach
if (result.optimizedProgram) {
  const fs = await import("fs/promises");

  // Apply all optimizations at once
  productReviewer.applyOptimization(result.optimizedProgram);

  console.log(`✨ Applied optimized configuration:`);
  console.log(`   Score: ${result.optimizedProgram.bestScore.toFixed(3)}`);
  console.log(`   Optimizer: ${result.optimizedProgram.optimizerType}`);
  console.log(
    `   Converged: ${result.optimizedProgram.converged ? "✅" : "❌"}`,
  );

  // Save complete optimization configuration
  await fs.writeFile(
    "product-reviewer-optimization.json",
    JSON.stringify(
      {
        version: "2.0",
        bestScore: result.optimizedProgram.bestScore,
        instruction: result.optimizedProgram.instruction,
        demos: result.optimizedProgram.demos,
        modelConfig: result.optimizedProgram.modelConfig,
        optimizerType: result.optimizedProgram.optimizerType,
        optimizationTime: result.optimizedProgram.optimizationTime,
        totalRounds: result.optimizedProgram.totalRounds,
        converged: result.optimizedProgram.converged,
        stats: result.optimizedProgram.stats,
        created: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "💾 Complete optimization saved to product-reviewer-optimization.json!",
  );
}

// 7. Test the optimized version
const testReview =
  "The item was okay but customer support was unhelpful when I had questions";
const analysis = await productReviewer.forward(llm, {
  productReview: testReview,
});

console.log("Analysis:", analysis);
// Expected: rating: '2' or '3', aspect: 'service', recommendation: 'avoid' or 'maybe'

// 8. Later in production - load complete optimization:
// import { AxOptimizedProgramImpl } from '@ax-llm/ax';
// const savedData = JSON.parse(await fs.readFile('product-reviewer-optimization.json', 'utf8'));
// const optimizedProgram = new AxOptimizedProgramImpl(savedData);
// productReviewer.applyOptimization(optimizedProgram);
// console.log(`🚀 Loaded complete optimization v${savedData.version} with score ${savedData.bestScore.toFixed(3)}`);
```

---

## 🎯 Key Takeaways

1. **Start simple**: 5 examples and basic optimization can give you 20-30%
   improvement
2. **Use the unified approach**:
   `program.applyOptimization(result.optimizedProgram)` - one call does
   everything!
3. **Save complete optimizations**: New v2.0 format includes demos, instruction,
   model config, and metadata
4. **Load optimizations cleanly**: Use `AxOptimizedProgramImpl` to recreate
   saved optimizations
5. **Teacher-student saves money**: Use expensive models to teach cheap ones
6. **Good examples matter more than lots of examples**: 10 diverse examples beat
   100 similar ones
7. **Measure what matters**: Your metric defines what the AI optimizes for
8. **Version comprehensively**: Track optimization versions, scores,
   convergence, and metadata
9. **Backward compatibility**: Legacy demo format still works, but upgrade for
   better experience
10. **Production-ready**: The unified approach is designed for enterprise
    production use

**Ready to optimize your first AI program?** Copy the examples above and start
experimenting!

**Questions?** Check the `src/examples/` folder for more real-world examples, or
refer to the troubleshooting section above.

---

## 📚 Quick Reference

### Essential Imports

```typescript
import { ai, ax, AxMiPRO, AxOptimizedProgramImpl } from "@ax-llm/ax";
```

### Basic Pattern (Copy This!)

```typescript
// 1. Define program
const program = ax(
  'inputText:string "description" -> output:class "a, b" "description"',
);

// 2. Create AI
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" },
});

// 3. Add examples
const examples = [{ inputText: "example", output: "a" }];

// 4. Define metric
const metric = ({ prediction, example }) =>
  prediction.output === example.output ? 1 : 0;

// 5. Optimize
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  options: { verbose: true },
});
const result = await optimizer.compile(program, examples, metric);

// 6. Apply optimization (unified approach)
if (result.optimizedProgram) {
  program.applyOptimization(result.optimizedProgram);
}
```

### Common Field Types

- `fieldName:string "description"` - Text input/output
- `fieldName:class "option1, option2" "description"` - Classification
- `fieldName:number "description"` - Numeric values
- `fieldName:string[] "description"` - Lists
- `fieldName:boolean "description"` - True/false

### Budget Control

```typescript
import { AxDefaultCostTracker } from "@ax-llm/ax";
const costTracker = new AxDefaultCostTracker({ maxTokens: 10000, maxCost: 5 });
// Add to optimizer: costTracker
```

### Teacher-Student (Cost Savings)

```typescript
const teacherAI = ai({ name: "openai", config: { model: "gpt-4o" } }); // Expensive
const studentAI = ai({
  name: "openai",
  config: { model: "gpt-4o-mini" },
}); // Cheap
// Use both in optimizer: { studentAI, teacherAI, ... }
```

### Unified Optimization (New in v14.0+)

```typescript
// Save complete optimization
const savedData = {
  version: "2.0",
  bestScore: result.optimizedProgram.bestScore,
  instruction: result.optimizedProgram.instruction,
  demos: result.optimizedProgram.demos,
  modelConfig: result.optimizedProgram.modelConfig, // temperature, etc.
  optimizerType: result.optimizedProgram.optimizerType,
  // ... all other optimization data
};

// Load and apply in production
const optimizedProgram = new AxOptimizedProgramImpl(savedData);
program.applyOptimization(optimizedProgram); // One call does everything!

// Benefits:
// ✅ Single object contains all optimization data
// ✅ One method call applies everything
// ✅ Complete metadata tracking
// ✅ Backward compatibility with legacy demos
// ✅ Production-ready versioning and deployment
```

---

_💡 Remember: Optimization is like having a personal AI tutor. You provide the
examples and goals, and it figures out the best way to teach your AI. Start
simple, measure results, and gradually make it more sophisticated as you learn
what works!_

---

## 💾 Checkpointing (Fault Tolerance)

Long-running optimizations can be expensive and time-consuming. Ax provides
simple function-based checkpointing to save optimization progress and recover
from failures.

### Why Use Checkpointing?

- **Cost Protection**: Don't lose expensive optimization work due to crashes
- **Fault Tolerance**: Resume optimization after interruptions
- **Experimentation**: Save optimization state at different points for analysis

### How It Works

Implement two simple functions to save and load checkpoint data:

```typescript
import { type AxCheckpointSaveFn, type AxCheckpointLoadFn } from '@ax-llm/ax'

const checkpointSave: AxCheckpointSaveFn = async (checkpoint) => {
  // JSON serialize the checkpoint and save it wherever you want:
  // - Memory: map.set(id, checkpoint)
  // - localStorage: localStorage.setItem(id, JSON.stringify(checkpoint))
  // - Database: await db.create({ data: checkpoint })
  // - Files: await fs.writeFile(`${id}.json`, JSON.stringify(checkpoint))
  // - Cloud: await s3.putObject({ Key: id, Body: JSON.stringify(checkpoint) })
  
  const id = `checkpoint_${Date.now()}`
  // Your storage implementation here
  return id
}

const checkpointLoad: AxCheckpointLoadFn = async (id) => {
  // Load and JSON parse the checkpoint data
  // Return null if not found
  return /* your loaded checkpoint */ || null
}

// Use with any optimizer
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  checkpointSave,
  checkpointLoad,
  checkpointInterval: 10, // Save every 10 rounds
  resumeFromCheckpoint: 'checkpoint_12345', // Resume from specific checkpoint
  options: { numTrials: 50, verbose: true }
})
```

### Key Points

- **Simple**: Just two functions - save and load
- **Storage Agnostic**: Works with any storage (memory, files, databases, cloud)
- **JSON Serializable**: Checkpoint data is just JSON - store it anywhere
- **Complete State**: Contains all optimization progress (scores,
  configurations, examples)
- **Browser Compatible**: No filesystem dependencies

The checkpoint contains complete optimization state, so you can resume exactly
where you left off, even after crashes or interruptions.

---

## 🐍 Python Optimization Service Integration

For advanced optimization scenarios requiring sophisticated Bayesian
optimization, Ax uses a production-ready Python service using Optuna. This is
required for MiPro v2 optimization with complex parameter spaces.

### When to Use Python Service

✅ **Great for:**

- Complex parameter optimization (10+ parameters)
- Bayesian optimization with acquisition functions
- Long-running optimization jobs (100+ trials)
- Production deployments requiring fault tolerance
- Distributed optimization across multiple machines
- Advanced pruning and sampling strategies

❌ **Note:** MiPro v2 requires the Python service; local TypeScript fallback is
no longer supported.

### Quick Setup with uv

The Python service uses `uv` for fast, modern Python package management:

```bash
# 1. Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Navigate to optimizer directory
cd src/optimizer

# 3. Install and run (that's it!)
uv sync
uv run ax-optimizer server start --debug
```

The service runs with an in-memory queue by default - no Redis or configuration
needed!

#### Production Setup (With Redis for Scaling)

```bash
# Install with Redis support
uv sync --group redis

# Start Redis (in another terminal)
docker run -p 6379:6379 redis:7-alpine

# Start the service
uv run ax-optimizer server start --debug
```

### CLI Usage

The service provides a comprehensive CLI for all operations:

```bash
# Server management
uv run ax-optimizer server start --host 0.0.0.0 --port 8000 --debug
uv run ax-optimizer server status
uv run ax-optimizer server stop

# Create MiPro optimization configuration
uv run ax-optimizer mipro create-config --output mipro_config.json

# Start optimization job
uv run ax-optimizer optimize --config mipro_config.json --monitor

# Monitor existing job
uv run ax-optimizer monitor <job_id>

# Get parameter suggestions (manual optimization loop)
uv run ax-optimizer suggest <study_name>

# Report trial results
uv run ax-optimizer evaluate <study_name> <trial_number> <score>

# Get final results
uv run ax-optimizer results <study_name>

# List all jobs
uv run ax-optimizer list --limit 20
```

### Docker Setup (Production)

For production deployments, use the provided Docker setup:

```bash
# Start all services (Redis, PostgreSQL, API, Workers)
cd src/optimizer
docker-compose up -d

# View logs
docker-compose logs -f

# Scale workers for performance
docker-compose up -d --scale worker=3

# Stop services
docker-compose down
```

### MiPro with Python Service

Here's how to use MiPro with the Python optimization service:

```typescript
import { ai, ax, type AxMetricFn, AxMiPRO } from "@ax-llm/ax";

// Email classification example
const emailClassifier = ax(
  'emailText:string "Email content" -> priority:class "critical, normal, low" "Email priority"',
);

const examples = [
  { emailText: "URGENT: Server down!", priority: "critical" },
  { emailText: "Meeting reminder", priority: "normal" },
  { emailText: "Newsletter update", priority: "low" },
  // ... more examples
];

const metric: AxMetricFn = ({ prediction, example }) => {
  return (prediction as any).priority === (example as any).priority ? 1.0 : 0.0;
};

// Configure MiPro with Python service
const optimizer = new AxMiPRO({
  studentAI: ai({
    name: "openai",
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: "gpt-4o-mini" },
  }),
  teacherAI: ai({
    name: "openai",
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: "gpt-4" },
  }),
  examples,

  // Python service configuration
  optimizerEndpoint: "http://localhost:8000",
  optimizerTimeout: 60000,
  optimizerRetries: 3,

  // Enhanced MiPro settings for Python service
  numTrials: 100, // More trials with Python
  bayesianOptimization: true,
  acquisitionFunction: "expected_improvement",
  explorationWeight: 0.15,

  // Self-consistency (MiPRO v2)
  // Ask the model for multiple independent samples and pick the best with a default majority-vote picker
  sampleCount: 3,

  // Progress tracking
  onProgress: (update) => {
    console.log(`Trial ${update.round}: ${update.currentScore.toFixed(3)}`);
  },
});

// Run optimization
const result = await optimizer.compile(emailClassifier, examples, metric);
console.log(`Best score: ${result.bestScore}`);
```

#### Custom Result Picker (Advanced)

```ts
import { type AxResultPickerFunction } from "@ax-llm/ax";

// Example: prefer higher confidence, break ties by shortest explanation
const myPicker: AxResultPickerFunction<any> = async (data) => {
  if (data.type === "function") {
    // Choose first non-error function execution
    const ix = data.results.findIndex((r) => !r.isError);
    return ix >= 0 ? ix : 0;
  }
  // Fields: choose highest confidence; tie-breaker shortest explanation
  let bestIx = 0;
  let bestScore = -Infinity;
  for (const r of data.results) {
    const sample = r.sample as { confidence?: number; explanation?: string };
    const score = (sample.confidence ?? 0) -
      (sample.explanation?.length ?? 0) / 1000;
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
  // Use 5 samples per example and custom picker
  sampleCount: 5,
  resultPicker: myPicker,
});
```

When to use:

- Use a custom picker when your task has a clear selection heuristic (e.g.,
  confidence, shortness, scoring rubric) or you want to implement an LLM-judge
  selection.
- For classification tasks, the built-in majority-vote default often works well.

#### New/Updated Options (MiPRO v2)

- `sampleCount?: number` (default: 1)
  - When > 1, MiPRO evaluates each example with multiple samples and uses a
    default result picker to select the best output per example. Great for tasks
    where self-consistency helps.
- Early stopping
  - Controlled by `earlyStoppingTrials` and `minImprovementThreshold`. MiPRO
    will stop if no trial improves the best score by at least the threshold for
    the configured number of trials.
- Minibatch scheduling
  - When `minibatch` is true, evaluations run on random minibatches. Every
    `minibatchFullEvalSteps` trials, MiPRO runs a full evaluation to correct
    drift from minibatch noise.
- Expanded logging
  - Progress is emitted each trial with score and configuration; early stopping
    is logged; final result includes score/configuration histories and accurate
    `optimizationTime`.

Note: MiPRO now applies suggested `bootstrappedDemos` during evaluation so that
the optimizer can learn their true effect on your metric.

#### Hyperparameters vs. MiPRO

MiPRO primarily optimizes the program-level levers emphasized in DSPy/MiPRO
(instructions, few-shot demos, data-aware proposals). Model hyperparameters
(e.g., `temperature`, `topP`, penalties) can be included for practical gains;
tuning `temperature` often helps self-consistency. The original MiPRO work
focuses on program synthesis and demo selection rather than broad model
hyperparameter sweeps. If you decide to extend the search space:

- Prefer a small, impactful set (e.g., `temperature`, occasionally `topP`).
- Keep ranges conservative to avoid noisy evaluations.
- Measure costs: a larger hyperparameter space increases trials.

Optional: Include topP in MiPRO

```ts
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples,
  // Keep it off by default; turn on if diversity helps your task
  optimizeTopP: true, // adds topP (0.7–1.0) to the optimizer search space
  sampleCount: 3, // pairs well with self-consistency
});
```

### Environment Variables

Configure the service with environment variables:

```bash
# .env file for Python service
HOST=0.0.0.0
PORT=8000
DEBUG=false
REDIS_URL=redis://localhost:6379/0
DATABASE_URL=postgresql://user:password@localhost/optimizer
USE_MEMORY_STORAGE=true  # Set to false for PostgreSQL persistence
MAX_TRIALS_PER_STUDY=1000
DEFAULT_TIMEOUT_SECONDS=3600
MAX_CONCURRENT_JOBS=10
```

### Production Features

The Python service includes enterprise-ready features:

**Fault Tolerance:**

- Automatic checkpointing and resumption
- Redis-based task queue with ARQ
- Background job processing
- Health checks and monitoring

**Scalability:**

- Horizontal scaling with multiple workers
- Database persistence with PostgreSQL
- Connection pooling and resource management
- Rate limiting and timeout controls

**Observability:**

- Comprehensive logging with structured output
- Metrics export for monitoring systems
- Job status tracking and history
- Error reporting and debugging tools

### Advanced Parameter Templates

The service includes optimized parameter templates for different scenarios:

```python
# Using the Python adapter directly
from app.mipro_adapter import MiProAdapter, MiProConfiguration

# Light optimization (fast, good for development)
config = MiProConfiguration(optimization_level="light")
adapter = MiProAdapter(config)

request = adapter.create_optimization_request(
    study_name="email_classification",
    parameter_sets=["instruction_generation", "demo_selection"]
)

# Medium optimization (balanced, good for most use cases)
config = MiProConfiguration(optimization_level="medium")

# Heavy optimization (thorough, good for production)
config = MiProConfiguration(optimization_level="heavy")
```

### Integration with TypeScript

Switch between local and Python optimization seamlessly:

```typescript
const optimizer = new AxMiPRO({
  studentAI,
  examples,
  numTrials: 100,
  optimizerEndpoint: process.env.OPTIMIZER_ENDPOINT || "http://localhost:8000",
  bayesianOptimization: true,
  acquisitionFunction: "expected_improvement",
  onProgress: (update) => {
    console.log(`Trial ${update.round}: ${update.currentScore.toFixed(3)}`);
  },
});
```

### Development Workflow

1. **Start with TypeScript** for quick prototyping:
   ```bash
   npm run tsx ./src/examples/mipro-python-optimizer.ts
   ```

2. **Scale to Python** for production optimization:
   ```bash
   # Terminal 1: Start Python service
   cd src/optimizer && uv run ax-optimizer server start

   # Terminal 2: Run with Python service
   USE_PYTHON_OPTIMIZER=true npm run tsx ./src/examples/mipro-python-optimizer.ts
   ```

3. **Deploy to production** with Docker:
   ```bash
   cd src/optimizer && docker-compose up -d
   ```

This provides a smooth development path from prototype to production with the
same codebase!
