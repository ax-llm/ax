---
title: "AxLearn: Self-Improving Agents"
description: "Zero-configuration optimization loop for Ax agents"
---

# AxLearn: Self-Improving Agents

AxLearn provides a zero-configuration optimization loop that enables your Ax agents to automatically improve their prompts using production logs and teacher models.

## Quick Start

```typescript
import { ax, ai, AxTuner, AxMemoryStorage } from '@ax-llm/ax';

// 1. Create your generator
const gen = ax(`customer_query -> polite_response`);

// 2. Create a tuner with a teacher model
const tuner = new AxTuner({
  teacher: ai('openai', { model: 'gpt-4o' }),
});

// 3. Tune your generator
const result = await tuner.tune(gen, {
  budget: 20,
});

// 4. Use the improved generator
const improved = result.improvedGen;
const response = await improved.forward(ai, { customer_query: 'Where is my order?' });
```

## Core Components

### AxStorage & AxMemoryStorage

Storage backends for persisting traces and checkpoints.

```typescript
import { AxMemoryStorage } from '@ax-llm/ax';

const storage = new AxMemoryStorage();

// Save a trace
await storage.saveTrace({
  id: 'trace-1',
  agentId: 'my-agent',
  input: { query: 'hello' },
  output: { response: 'hi there' },
  startTime: new Date(),
  endTime: new Date(),
  durationMs: 100,
});

// Query traces
const traces = await storage.getTraces('my-agent', {
  limit: 10,
  hasFeedback: true,
});

// Add user feedback
await storage.addFeedback('trace-1', {
  score: 0.9,
  label: 'good',
  comment: 'Great response!',
});
```

### AxTraceLogger

Decorator that wraps `AxGen` to automatically log all forward() calls.

```typescript
import { AxTraceLogger, AxMemoryStorage, ax, ai } from '@ax-llm/ax';

const gen = ax(`query -> response`);
const storage = new AxMemoryStorage();

const tracedGen = new AxTraceLogger(gen, {
  agentId: 'my-agent',
  storage,
  onTrace: (trace) => console.log(`Logged trace: ${trace.id}`),
});

// Use exactly like AxGen - traces are logged automatically
const result = await tracedGen.forward(ai, { query: 'Hello' });
```

### AxSynth

Generates synthetic training data when you don't have examples.

```typescript
import { AxSynth, ax, ai } from '@ax-llm/ax';

const signature = ax(`customer_query -> polite_response`).getSignature();

const synth = new AxSynth(signature, {
  teacher: ai('openai', { model: 'gpt-4o' }),
  domain: 'customer support',
  edgeCases: ['angry customers', 'vague requests'],
});

const { examples, stats } = await synth.generate(100);
console.log(`Generated ${examples.length} examples`);
```

### AxJudge

**Polymorphic & Relativistic Evaluation Engine**

AxJudge automatically selects the best evaluation strategy based on available data.

Based on insights from the [RARO paper](https://arxiv.org/abs/2511.21667) ("Escaping the Verifier: Learning to Reason via Demonstrations"):
- LLMs are more reliable at **pairwise comparison** than absolute scoring
- The **"tie" option** is critical for stable evaluation
- **Discrete classification** is more reliable than numeric scores

```typescript
import { AxJudge, ax, ai } from '@ax-llm/ax';

const signature = ax(`question -> answer`).getSignature();
const judge = new AxJudge(signature, { ai: teacherAI });

// Automatically routes to the best evaluation strategy:

// 1. ABSOLUTE MODE (ground truth available)
const result1 = await judge.evaluate(
  { question: 'What is 2+2?' },
  { answer: '4' },      // student output
  { answer: '4' }       // expected (exact match = 1.0)
);
console.log(result1.mode);  // 'absolute'
console.log(result1.score); // 1.0

// 2. RELATIVISTIC MODE (compare student vs teacher)
const studentOutput = await studentGen.forward(studentAI, input);
const teacherOutput = await teacherGen.forward(teacherAI, input);

const result2 = await judge.evaluate(
  input,
  studentOutput,  // student answer
  teacherOutput   // teacher answer (reference)
);
console.log(result2.mode);   // 'relativistic'
console.log(result2.winner); // 'student' | 'teacher' | 'tie'
console.log(result2.score);  // 1.0 (win), 0.5 (tie), 0.0 (loss)

// 3. REFERENCE-FREE MODE (discrete quality tiers)
const result3 = await judge.evaluate(
  { question: 'Write a poem' },
  { answer: 'Roses are red...' }
  // No reference - uses discrete quality classification
);
console.log(result3.mode);        // 'reference-free'
console.log(result3.qualityTier); // 'excellent' | 'good' | 'acceptable' | 'poor' | 'unacceptable'
console.log(result3.score);       // mapped: 1.0, 0.8, 0.5, 0.2, 0.0
```

**Evaluation Modes:**

| Mode | Trigger | Mechanism | Output |
|------|---------|-----------|--------|
| **Absolute** | Ground truth + exact match | Direct comparison | Score per field |
| **Relativistic** | Reference output provided | A/B comparison with tie | Winner + score |
| **Reference-Free** | No comparison data | Discrete quality tiers | Tier + score |

**Why This Design (per RARO paper):**
- **Pairwise comparison** is more reliable than absolute scoring
- **Tie option** prevents critic collapse and stabilizes learning
- **Discrete tiers** avoid the variance issues of numeric scoring
- **Position randomization** (A/B) reduces bias

### AxTuner

High-level orchestrator that combines everything.

```typescript
import { AxTuner, AxMemoryStorage, ax, ai } from '@ax-llm/ax';

const gen = ax(`customer_query -> polite_response`);
const storage = new AxMemoryStorage();

const tuner = new AxTuner({
  teacher: ai('openai', { model: 'gpt-4o' }),
  storage,
});

const result = await tuner.tune(gen, {
  budget: 20,
  agentId: 'support-bot',
  onProgress: (p) => console.log(`Round ${p.round}: ${p.score}`),
});

// checkpoint is automatically saved
console.log(`Achieved score: ${result.score}`);
```

### AxLearnAgent

Combines AxGen + AxTraceLogger + AxTuner for convenience.

```typescript
import { AxLearnAgent, ax, ai } from '@ax-llm/ax';

const gen = ax(`customer_query -> polite_response`);

const agent = new AxLearnAgent(gen, {
  name: 'support-bot-v1',
});

// Use in production - traces logged automatically
const result = await agent.forward(ai, { customer_query: 'Where is my order?' });

// Tune when ready
await agent.tune({
  teacher: ai('openai', { model: 'gpt-4o' }),
  budget: 20,
});

// Get traces for analysis
const traces = await agent.getTraces({ limit: 100 });
```

## Workflow

```
┌──────────────────────────────────────────────────────────────┐
│  Production Runtime                                          │
│  ┌─────────┐    ┌───────────────┐    ┌──────────────────────┐│
│  │ AxGen   │───▶│ AxTraceLogger │───▶│ AxStorage (traces)   ││
│  └─────────┘    └───────────────┘    └──────────────────────┘│
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Offline Tuning (AxTuner)                                    │
│                                                              │
│  ┌─────────┐  generates   ┌────────────────┐                 │
│  │ AxSynth │─────────────▶│ Training Data  │                 │
│  └─────────┘              └────────────────┘                 │
│       │                          │                           │
│       │ uses                     │                           │
│       ▼                          ▼                           │
│  ┌─────────┐              ┌──────────────┐                   │
│  │ Teacher │              │ Optimizer    │                   │
│  │   AI    │              │ (Bootstrap)  │                   │
│  └─────────┘              └──────────────┘                   │
│       │                          │                           │
│       │ provides                 │ evaluates                 │
│       ▼                          ▼                           │
│  ┌─────────┐              ┌───────────────┐                  │
│  │ AxJudge │◀─────────────│ Improved Gen  │                  │
│  └─────────┘              └───────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

## Best Practices

1. **Start with traces**: Deploy your generator with `AxTraceLogger` to collect real-world data
2. **Use user feedback**: Call `storage.addFeedback()` when users rate responses
3. **Tune offline**: Run `AxTuner.tune()` periodically with collected data
4. **Checkpoint versions**: Use `agentId` to track different versions
5. **Choose rubrics wisely**: Pick the rubric that best matches your quality goals
