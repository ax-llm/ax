# LLM Optimization Made Simple: A Beginner's Guide to Ax

**Goal**: Learn how to make your AI programs smarter, faster, and cheaper
through automatic optimization. **Time to first results**: 5 minutes

## 📋 Table of Contents

- [What is LLM Optimization?](#what-is-llm-optimization)
- [🚀 5-Minute Quick Start](#-5-minute-quick-start) ← **Start here!**
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

import { ax, AxAI, AxMiPRO, f } from "@ax-llm/ax";
```

### Step 2: Create Your First Optimizable Program

```typescript
// This is a simple sentiment analyzer - we'll make it smarter!
const sentimentAnalyzer = ax`
  reviewText:${f.string("Customer review")} -> 
  sentiment:${
  f.class(["positive", "negative", "neutral"], "How the customer feels")
}
`;

// Set up your AI
const ai = new AxAI({
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
  studentAI: ai,
  examples,
  options: { verbose: true }, // Show progress
});

// Let it optimize (takes 1-2 minutes)
console.log("🔄 Optimizing your AI program...");
const result = await optimizer.compile(sentimentAnalyzer, metric);

// Apply the improvements
if (result.demos) {
  sentimentAnalyzer.setDemos(result.demos);
}

console.log(
  `✅ Done! Improved from baseline to ${result.bestScore * 100}% accuracy`,
);
```

### Step 6: Test Your Improved AI

```typescript
// Test it out!
const testReview =
  "The product arrived quickly but the quality was disappointing";
const analysis = await sentimentAnalyzer.forward(ai, {
  reviewText: testReview,
});

console.log("Analysis:", analysis.sentiment); // Much more accurate now!
```

**🎉 Congratulations!** You just automatically improved an AI program. The
optimizer found better prompts and examples without you having to manually
experiment.

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
const emailClassifier = ax`
  emailContent:${f.string("Email text")} -> 
  category:${f.class(["urgent", "normal", "spam"], "Email priority")},
  needsReply:${f.class(["yes", "no"], "Does this need a response?")}
`;

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
const supportRouter = ax`
  customerMessage:${f.string("Customer inquiry")} -> 
  department:${
  f.class(["billing", "technical", "general"], "Which team should handle this")
},
  urgency:${f.class(["low", "medium", "high"], "How urgent is this")}
`;

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
const contentModerator = ax`
  userPost:${f.string("User-generated content")} -> 
  safe:${f.class(["yes", "no"], "Is this content appropriate?")},
  reason:${f.string("Why was this flagged (if unsafe)")}
`;

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
const teacherAI = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o" }, // The expensive one
});

// Student: Fast and cheap (used for actual work)
const studentAI = new AxAI({
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
const result = await optimizer.compile(program, metric);
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
  studentAI: new AxAI({
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

### 2. Multi-Objective Optimization

**When you care about multiple things**:

```typescript
const multiMetric = ({ prediction, example }) => ({
  accuracy: prediction.category === example.category ? 1 : 0,
  speed: 1 / (prediction.responseTime || 1),
  confidence: prediction.confidence || 0,
});

// Find the best trade-offs automatically
const result = await optimizer.compilePareto(program, multiMetric);
console.log(`Found ${result.paretoFrontSize} optimal solutions`);
```

### 3. Chain Multiple Programs

```typescript
// First program: Extract key info
const extractor = ax`
  email:${f.string("Email content")} -> 
  keyPoints:${f.array(f.string("Important points"))}
`;

// Second program: Classify based on extracted info
const classifier = ax`
  keyPoints:${f.array(f.string("Key points"))} -> 
  priority:${f.class(["low", "medium", "high"], "Email priority")}
`;

// Optimize them separately, then chain them
const extractResult = await extractOptimizer.compile(extractor, extractMetric);
const classifyResult = await classifyOptimizer.compile(
  classifier,
  classifyMetric,
);

// Use them together
const email = "Meeting moved to 3pm tomorrow, please confirm";
const keyPoints = await extractor.forward(ai, { email });
const priority = await classifier.forward(ai, {
  keyPoints: keyPoints.keyPoints,
});
```

---

## 📖 Complete Working Example

Here's a full example you can copy, paste, and run:

```typescript
import { ax, AxAI, AxMiPRO, f } from "@ax-llm/ax";

// 1. Define the task
const productReviewer = ax`
  productReview:${f.string("Customer product review")} -> 
  rating:${f.class(["1", "2", "3", "4", "5"], "Star rating 1-5")},
  aspect:${
  f.class(["quality", "price", "shipping", "service"], "Main concern")
},
  recommendation:${f.class(["buy", "avoid", "maybe"], "Would you recommend?")}
`;

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
const ai = new AxAI({
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
  studentAI: ai,
  examples,
  options: { verbose: true },
});

console.log("🔄 Starting optimization...");
const result = await optimizer.compile(productReviewer, metric);

if (result.demos) {
  productReviewer.setDemos(result.demos);
}

console.log(
  `✅ Optimization complete! Score improved to ${
    (result.bestScore * 100).toFixed(1)
  }%`,
);

// 6. Test it
const testReview =
  "The item was okay but customer support was unhelpful when I had questions";
const analysis = await productReviewer.forward(ai, {
  productReview: testReview,
});

console.log("Analysis:", analysis);
// Expected: rating: '2' or '3', aspect: 'service', recommendation: 'avoid' or 'maybe'
```

---

## 🎯 Key Takeaways

1. **Start simple**: 5 examples and basic optimization can give you 20-30%
   improvement
2. **Teacher-student saves money**: Use expensive models to teach cheap ones
3. **Good examples matter more than lots of examples**: 10 diverse examples beat
   100 similar ones
4. **Measure what matters**: Your metric defines what the AI optimizes for
5. **Iterate and improve**: Start basic, then add complexity as you learn

**Ready to optimize your first AI program?** Copy the examples above and start
experimenting!

**Questions?** Check the `src/examples/` folder for more real-world examples, or
refer to the troubleshooting section above.

---

## 📚 Quick Reference

### Essential Imports

```typescript
import { ax, AxAI, AxMiPRO, f } from "@ax-llm/ax";
```

### Basic Pattern (Copy This!)

```typescript
// 1. Define program
const program = ax`input:${f.string("description")} -> output:${
  f.class(["a", "b"], "description")
}`;

// 2. Create AI
const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" },
});

// 3. Add examples
const examples = [{ input: "example", output: "a" }];

// 4. Define metric
const metric = ({ prediction, example }) =>
  prediction.output === example.output ? 1 : 0;

// 5. Optimize
const optimizer = new AxMiPRO({
  studentAI: ai,
  examples,
  options: { verbose: true },
});
const result = await optimizer.compile(program, metric);
if (result.demos) program.setDemos(result.demos);
```

### Common Field Types

- `f.string('description')` - Text input/output
- `f.class(['option1', 'option2'], 'description')` - Classification
- `f.number('description')` - Numeric values
- `f.array(f.string('item description'))` - Lists
- `f.boolean('description')` - True/false

### Budget Control

```typescript
import { AxDefaultCostTracker } from "@ax-llm/ax";
const costTracker = new AxDefaultCostTracker({ maxTokens: 10000, maxCost: 5 });
// Add to optimizer: costTracker
```

### Teacher-Student (Cost Savings)

```typescript
const teacherAI = new AxAI({ name: "openai", config: { model: "gpt-4o" } }); // Expensive
const studentAI = new AxAI({
  name: "openai",
  config: { model: "gpt-4o-mini" },
}); // Cheap
// Use both in optimizer: { studentAI, teacherAI, ... }
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
  studentAI: ai,
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
