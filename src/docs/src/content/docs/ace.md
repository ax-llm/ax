---
title: "ACE Guide"
description: "Advanced ACE framework capabilities"
---

# Agentic Context Engineering (ACE)

ACE (Agentic Context Engineering) provides a structured approach to evolving AI program context through iterative refinement loops. Unlike traditional prompt optimization, ACE maintains a persistent, structured "playbook" that grows and adapts over time.

## Table of Contents

- [What is ACE?](#what-is-ace)
- [When to Use ACE](#when-to-use-ace)
- [How ACE Works](#how-ace-works)
- [Quick Start](#quick-start)
- [Online Adaptation](#online-adaptation)
- [Understanding ACE Components](#understanding-ace-components)
- [Customizing ACE Prompts](#customizing-ace-prompts)
- [Complete Working Example](#complete-working-example)
- [Best Practices](#best-practices)

## What is ACE?

**The Problem**: Iteratively rewriting a giant system prompt causes brevity bias and context collapse—hard-won strategies disappear after a few updates. You need a way to grow and refine a durable playbook both offline and online.

**The Solution**: Use `AxACE`, an optimizer that mirrors the ACE paper's Generator → Reflector → Curator loop. It represents context as structured bullets, applies incremental deltas, and returns a serialized playbook you can save, load, and keep updating at inference time.

## When to Use ACE

✅ **Perfect for:**

- Programs that need to learn from ongoing feedback
- Systems requiring structured, evolving knowledge bases
- Tasks where context needs to persist and grow over time
- Scenarios with incremental learning from production data
- Cases where prompt brevity bias is a concern

❌ **Skip for:**

- Simple classification tasks (use MiPRO instead)
- One-time optimizations without ongoing updates
- Tasks that don't benefit from structured memory
- Quick prototypes needing fast results

## How ACE Works

ACE implements a three-component loop:

1. **Generator**: Your program that performs the task
2. **Reflector**: Analyzes generator performance and identifies improvements
3. **Curator**: Updates the playbook with structured, incremental changes

The playbook is represented as structured bullets organized into sections, allowing for targeted updates without context collapse.

## Quick Start

### Step 1: Define Your Program

```typescript
import { ax, AxAI, AxACE, type AxMetricFn, f } from "@ax-llm/ax";

const student = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o-mini" },
});

const teacher = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: "gpt-4o" },
});

const classifier = ax(
  'ticket:string "Support ticket text" -> severity:class "low, medium, high" "Incident severity"'
);

classifier.setDescription(
  "Classify the severity of the support ticket and explain your reasoning."
);
```

### Step 2: Provide Training Examples

```typescript
const examples = [
  { ticket: "Billing portal returns 502 errors globally.", severity: "high" },
  { ticket: "UI misaligned on Safari but usable.", severity: "low" },
  { ticket: "Checkout intermittently drops vouchers.", severity: "medium" },
];
```

### Step 3: Define Success Metric

```typescript
const metric: AxMetricFn = ({ prediction, example }) =>
  prediction.severity === example.severity ? 1 : 0;
```

### Step 4: Run ACE Optimization

```typescript
const optimizer = new AxACE(
  { studentAI: student, teacherAI: teacher, verbose: true },
  { maxEpochs: 2 }
);

console.log('🚀 Running ACE offline optimization...');
const result = await optimizer.compile(classifier, examples, metric);

// Apply the optimized playbook
result.optimizedProgram?.applyTo(classifier);

console.log(`✅ Optimization complete!`);
console.log(`Score: ${result.optimizedProgram?.bestScore.toFixed(3)}`);
```

### Step 5: Save and Load the Playbook

```typescript
import fs from "node:fs/promises";

// Save the structured playbook
await fs.writeFile(
  "ace-playbook.json",
  JSON.stringify(result.artifact.playbook, null, 2)
);

// Later, load the playbook
const loadedPlaybook = JSON.parse(
  await fs.readFile("ace-playbook.json", "utf8")
);

const onlineOptimizer = new AxACE(
  { studentAI: student, teacherAI: teacher },
  { initialPlaybook: loadedPlaybook }
);
```

## Online Adaptation

ACE's key feature is online learning—updating the playbook based on real-world feedback.

```typescript
// New example from production
const newTicket = {
  ticket: "VIP equities desk reports quote stream silent",
  severity: "high",
};

// Get prediction
const prediction = await classifier.forward(student, newTicket);

// Apply online update with feedback
const curatorDelta = await optimizer.applyOnlineUpdate({
  example: newTicket,
  prediction,
  feedback: "Escalation confirmed SEV-1. Reward guidance about VIP customer clauses.",
});

if (curatorDelta?.operations?.length) {
  console.log(`Added ${curatorDelta.operations.length} new playbook bullets`);
}
```

## Understanding ACE Components

### Generator

ACE uses the program you pass into `optimizer.compile(...)` as the Generator. You own the signature and the base system instruction—ACE simply appends the evolving playbook when it calls `forward`.

```typescript
const generatorSig = f()
  .input('ticket', f.string('Concise incident summary'))
  .input('impact', f.string('Observed customer or business impact'))
  .input('scope', f.string('Reported scope of the issue'))
  .input('signals', f.string('Supporting telemetry or operational signals'))
  .output('severity', f.class(['low', 'medium', 'high'], 'Incident severity label'))
  .output('reasoning', f.string('Brief rationale referencing internal incident policy'))
  .build();

const generator = ax(generatorSig);
generator.setDescription(`You are doing first-pass incident triage ...`);
```

At compile-time ACE stitches the playbook beneath whatever instruction you provide.

### Reflector

The reflector program is generated lazily inside `AxACE`. Its schema is:

```typescript
const reflector = ax(
  `
  question:string "Original task input serialized as JSON",
  generator_answer:string "Generator output serialized as JSON",
  generator_reasoning?:string "Generator reasoning trace",
  playbook:string "Current context playbook rendered as markdown",
  expected_answer?:string "Expected output when ground truth is available",
  feedback?:string "External feedback or reward signal",
  previous_reflection?:string "Most recent reflection JSON when running multi-round refinement" ->
  reasoning:string "Step-by-step analysis of generator performance",
  errorIdentification:string "Specific mistakes detected",
  rootCauseAnalysis:string "Underlying cause of the error",
  correctApproach:string "What the generator should do differently",
  keyInsight:string "Reusable insight to remember",
  bulletTags:json "Array of {id, tag} entries referencing playbook bullets"
  `,
);
```

### Curator

The curator schema tracks the paper's delta-output contract:

```typescript
const curator = ax(
  `
  playbook:string "Current playbook serialized as JSON",
  reflection:string "Latest reflection output serialized as JSON",
  question_context:string "Original task input serialized as JSON",
  token_budget?:number "Approximate token budget for curator response" ->
  reasoning:string "Justification for the proposed updates",
  operations:json "List of operations with type/section/content fields"
  `,
);
```

## Customizing ACE Prompts

By default Ax synthesizes prompts from the signatures. If you want to drop in custom prompts (e.g., from the ACE paper's Appendix D), you can override them:

### Customizing Reflector Prompt

```typescript
const optimizer = new AxACE({ studentAI, teacherAI });
const reflector = (optimizer as any).getOrCreateReflectorProgram?.call(optimizer);
reflector?.setDescription(myCustomReflectorPrompt);
```

### Customizing Curator Prompt

```typescript
const curator = (optimizer as any).getOrCreateCuratorProgram?.call(optimizer);
curator?.setDescription(myCustomCuratorPrompt);
```

### Where to Hook In

Until helper setters land, reaching the underlying programs through the internal `getOrCreateReflectorProgram` / `getOrCreateCuratorProgram` methods (as shown above) is the supported path.

📌 **Tip:** The reflector and curator signatures live in `src/ax/dsp/optimizers/ace.ts`. Search for `getOrCreateReflectorProgram` and `getOrCreateCuratorProgram` if you need to track future changes.

## Complete Working Example

> **📖 Full Example**: `src/examples/ace-train-inference.ts` demonstrates offline training plus an online adaptation pass.

```typescript
import { ax, AxAI, AxACE, type AxMetricFn, f } from "@ax-llm/ax";
import fs from "node:fs/promises";

async function run() {
  const student = new AxAI({
    name: "openai",
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: "gpt-4o-mini" },
  });

  const teacher = new AxAI({
    name: "openai",
    apiKey: process.env.OPENAI_APIKEY!,
    config: { model: "gpt-4o" },
  });

  const signatureSource = f()
    .input("ticket", f.string("Concise incident summary"))
    .input("impact", f.string("Observed customer or business impact"))
    .input("scope", f.string("Reported scope of the issue"))
    .input("signals", f.string("Supporting telemetry or operational signals"))
    .output("severity", f.class(["low", "medium", "high"], "Incident severity label"))
    .output("reasoning", f.string("Brief rationale referencing internal incident policy"))
    .build()
    .toString();

  const baseInstruction = `You are doing first-pass incident triage. Use the table below and do not deviate from it.
- single-user -> low
- regional -> medium
- global -> high
- internal -> low`;

  const program = ax(signatureSource);
  program.setDescription(baseInstruction);

  const trainExamples = [
    {
      ticket: "Fraud rules flag 80% of card transactions in CA region",
      impact: "Legitimate purchases blocked for many customers",
      scope: "regional",
      signals: "Chargeback rate flat, ruleset pushed 10 minutes ago",
      severity: "high",
    },
    {
      ticket: "Global search results delayed during planned reindex",
      impact: "Catalog searchable but updates appear 20 minutes late",
      scope: "global",
      signals: "Maintenance ticket CAB-512 approved, no customer complaints",
      severity: "medium",
    },
  ];

  const metric: AxMetricFn = ({ prediction, example }) =>
    (prediction as any).severity === (example as any).severity ? 1 : 0;

  const optimizer = new AxACE(
    { studentAI: student, teacherAI: teacher, verbose: true },
    { maxEpochs: 2, allowDynamicSections: true }
  );

  console.log("\n🚀 Running ACE offline optimization...");
  const result = await optimizer.compile(program, trainExamples, metric, {
    aceOptions: { maxEpochs: 2 },
  });

  const optimizedProgram = ax(signatureSource);
  optimizedProgram.setDescription(baseInstruction);
  result.optimizedProgram?.applyTo(optimizedProgram);

  console.log(`✅ ACE produced ${result.artifact.history.length} curator updates`);

  // Save playbook
  await fs.writeFile(
    "ace-playbook.json",
    JSON.stringify(result.artifact.playbook, null, 2)
  );

  // Online update
  const newTicket = {
    ticket: "VIP equities desk reports quote stream silent",
    impact: "Tier-1 customer cannot trade; contractual penalties kick in soon",
    scope: "single-user",
    signals: "Quote service returns 503 for client subnet",
    severity: "high",
  };

  const prediction = await optimizedProgram.forward(student, newTicket);

  console.log("\n🧠 Applying online update...");
  const curatorDelta = await optimizer.applyOnlineUpdate({
    example: newTicket,
    prediction,
    feedback: "Escalation confirmed SEV-1. Reward guidance about VIP clauses.",
  });

  if (curatorDelta?.operations?.length) {
    console.log(`Added ${curatorDelta.operations.length} new playbook bullets`);
  }
}

run().catch((error) => {
  console.error("💥 ACE example failed", error);
  process.exit(1);
});
```

## Best Practices

### 1. Start with Clear Base Instructions

Provide a clear, structured base instruction for your generator. ACE will augment it, not replace it.

```typescript
const baseInstruction = `You are doing first-pass incident triage. Use the table below:
- single-user -> low
- regional -> medium
- global -> high
- internal -> low`;

program.setDescription(baseInstruction);
```

### 2. Use Structured Examples

Provide diverse, well-structured training examples that cover edge cases.

### 3. Meaningful Feedback for Online Updates

When doing online updates, provide clear, actionable feedback:

```typescript
const feedback = "Escalation confirmed SEV-1. Reward guidance about VIP customer clauses.";
```

### 4. Monitor Playbook Growth

Periodically review your playbook to ensure it's growing in useful directions:

```typescript
const playbook = result.artifact.playbook;
console.log("\n📘 Learned playbook sections:");
for (const [section, bullets] of Object.entries(playbook.sections)) {
  console.log(`- ${section}: ${bullets.length} bullets`);
}
```

### 5. Save Playbooks for Future Sessions

Always save your optimized playbooks—they represent learned knowledge:

```typescript
await fs.writeFile(
  "ace-playbook.json",
  JSON.stringify(result.artifact.playbook, null, 2)
);
```

### 6. Combine Offline and Online Learning

Use offline optimization for initial training, then continue with online updates in production:

```typescript
// Offline: Initial training
const result = await optimizer.compile(program, trainExamples, metric);

// Online: Continuous improvement
const delta = await optimizer.applyOnlineUpdate({ example, prediction, feedback });
```

## Why ACE Matters

- **Structured memory**: Playbooks of tagged bullets persist across runs
- **Incremental updates**: Curator operations apply as deltas, so context never collapses
- **Offline + Online**: Same optimizer supports batch training and per-sample updates
- **Unified artifacts**: `AxACEOptimizedProgram` extends `AxOptimizedProgramImpl`, so you can save/load/apply like MiPRO or GEPA

## See Also

- [OPTIMIZE.md](/optimize/) - Main optimization guide
- [MIPRO.md](/mipro/) - MiPRO optimizer documentation
- [GEPA.md](/gepa/) - Multi-objective optimization
- `src/examples/ace-train-inference.ts` - Complete working example
