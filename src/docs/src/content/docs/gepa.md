---
title: "GEPA: Multi-Objective Optimization"
description: "Multi-objective optimization with Pareto frontiers for balancing competing goals"
---

# GEPA: Multi-Objective Optimization

GEPA (Genetic Evolutionary Programming with Agents) provides multi-objective optimization for AI programs when you need to balance multiple competing goals.

## What is Multi-Objective Optimization?

**The Problem**: Sometimes you care about multiple things at once - accuracy AND speed AND cost. Traditional optimization only handles one objective at a time.

**The Solution**: Use `AxGEPA` (single-module) or `AxGEPAFlow` (multi-module) with a multi-objective metric. Both use `compile(...)` and return a Pareto frontier of trade-offs plus hypervolume metrics.

## When to Use GEPA

✅ **Perfect for:**

- Content moderation (accuracy vs speed vs cost)
- Customer service routing (response time vs routing accuracy vs resource usage)
- Email classification (precision vs recall vs processing speed)
- Product recommendations (relevance vs diversity vs computation cost)

❌ **Skip for:**

- Single clear objective (use regular `AxMiPRO.compile`)
- When one objective is clearly most important
- Quick prototyping (multi-objective adds complexity)

## Understanding Pareto Optimization

A solution is "Pareto optimal" if you can't improve one objective without making another objective worse. The collection of all such solutions is called the "Pareto frontier."

**Example**:

- Solution A: 90% accuracy, 100ms response time, $0.10 cost
- Solution B: 85% accuracy, 50ms response time, $0.05 cost
- Solution C: 80% accuracy, 200ms response time, $0.08 cost

Solutions A and B are both Pareto optimal (A is more accurate but slower/expensive, B is faster/cheaper but less accurate). Solution C is dominated by both A and B.

## Quick Start

### Step 1: Define Your Multi-Objective Metric

```typescript
import { ai, ax, AxGEPA } from "@ax-llm/ax";

// Two-objective demo: accuracy (classification) + brevity (short rationale)
const moderator = ax(`
  userPost:string "User content" ->
  isSafe:class "safe, unsafe" "Safety",
  rationale:string "One concise sentence"
`);

const multiMetric = ({ prediction, example }) => {
  const accuracy = prediction?.isSafe === example?.isSafe ? 1 : 0;
  const rationale = typeof prediction?.rationale === 'string' ? prediction.rationale : '';
  const len = rationale.length;
  const brevity = len <= 30 ? 1 : len <= 60 ? 0.7 : len <= 100 ? 0.4 : 0.1;
  return { accuracy, brevity };
};
```

### Step 2: Run GEPA Optimization

```typescript
const student = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: { model: 'gpt-4o-mini' }
});

const optimizer = new AxGEPA({
  studentAI: student,
  numTrials: 16,
  minibatch: true,
  verbose: true
});

console.log("🔄 Finding Pareto trade-offs...");
const result = await optimizer.compile(
  moderator,
  trainExamples,
  multiMetric,
  {
    validationExamples: valExamples,
    maxMetricCalls: 200, // Required to bound evaluation cost
  }
);

console.log(`✅ Found ${result.paretoFrontSize} Pareto points`);
console.log(`📊 Hypervolume (2D): ${result.hypervolume ?? 'N/A'}`);
```

### Step 3: Apply and Save

```typescript
// Apply the optimized configuration
if (result.optimizedProgram) {
  moderator.applyOptimization(result.optimizedProgram);

  console.log(`✨ Applied GEPA optimization:`);
  console.log(`   Score: ${result.optimizedProgram.bestScore.toFixed(3)}`);
  console.log(`   Optimizer: ${result.optimizedProgram.optimizerType}`); // "GEPA"

  // Save (same format as MiPRO)
  await fs.writeFile(
    "gepa-optimization.json",
    JSON.stringify({
      version: "2.0",
      bestScore: result.optimizedProgram.bestScore,
      instruction: result.optimizedProgram.instruction,
      demos: result.optimizedProgram.demos,
      examples: result.optimizedProgram.examples,
      modelConfig: result.optimizedProgram.modelConfig,
      optimizerType: result.optimizedProgram.optimizerType,
      timestamp: new Date().toISOString(),
    }, null, 2)
  );
}
```

## Advanced Multi-Objective Patterns

### Cost-Quality Trade-off

```typescript
const multiMetric = ({ prediction, example }) => ({
  accuracy: prediction.category === example.category ? 1 : 0,
  cost: 1 / (estimateTokenCost(prediction) + 1), // Inverse cost (higher = cheaper)
  speed: 1 / (prediction.responseTime || 1000), // Inverse time (higher = faster)
});
```

### Precision-Recall Optimization

```typescript
const multiMetric = ({ prediction, example }) => {
  const truePositive =
    prediction.category === "positive" && example.category === "positive" ? 1 : 0;
  const falsePositive =
    prediction.category === "positive" && example.category !== "positive" ? 1 : 0;
  const falseNegative =
    prediction.category !== "positive" && example.category === "positive" ? 1 : 0;

  return {
    precision: falsePositive === 0 ? 1 : (truePositive / (truePositive + falsePositive)),
    recall: falseNegative === 0 ? 1 : (truePositive / (truePositive + falseNegative)),
  };
};
```

## GEPA-Flow for Multi-Module Programs

```typescript
import { AxGEPAFlow, flow, ai } from "@ax-llm/ax";

const pipeline = flow<{ emailText: string }>()
  .n('classifier', 'emailText:string -> priority:class "high, normal, low"')
  .n('rationale', 'emailText:string, priority:string -> rationale:string "One concise sentence"')
  .e('classifier', (s) => ({ emailText: s.emailText }))
  .e('rationale', (s) => ({ emailText: s.emailText, priority: s.classifierResult.priority }))
  .m((s) => ({ priority: s.classifierResult.priority, rationale: s.rationaleResult.rationale }));

const optimizer = new AxGEPAFlow({
  studentAI: ai({ name: 'openai', config: { model: 'gpt-4o-mini' } }),
  numTrials: 16
});

const result = await optimizer.compile(
  pipeline,
  train,
  multiMetric,
  { validationExamples: val, maxMetricCalls: 240 }
);

console.log(`Front size: ${result.paretoFrontSize}, Hypervolume: ${result.hypervolume}`);
```

## Understanding Results

```typescript
// Key properties of AxParetoResult:
console.log(`Pareto frontier size: ${result.paretoFrontSize}`);
console.log(`Best scalarized score: ${result.bestScore}`);
console.log(`Hypervolume (2D only): ${result.hypervolume}`);

// Inspect frontier points
for (const [i, p] of [...result.paretoFront].entries()) {
  if (i >= 3) break;
  console.log(`#${i+1}: acc=${p.scores.accuracy?.toFixed(3)}, brev=${p.scores.brevity?.toFixed(3)}`);
}
```

## Performance Considerations

- **Runtime**: Scales with `numTrials`, validation size, and `maxMetricCalls`
- **Cost**: Bound evaluations with `maxMetricCalls`; consider minibatching
- **Scalability**: Works best with 2–4 objectives; hypervolume reporting is 2D
- **Determinism**: Provide `seed` for reproducibility

## Tips for Success

1. **Start with 2-3 objectives**: More objectives make selection harder
2. **Scale objectives similarly (0–1)** for fair comparison
3. **Use `paretoMetricKey` or `paretoScalarize`** to guide selection/tie-breaks
4. **Validate chosen trade-offs** on holdout sets
5. **Keep validation small** to control cost

## Examples

- `src/examples/gepa-quality-vs-speed-optimization.ts` - Complete multi-objective example

## See Also

- [Optimization Guide](/optimize) - Main optimization guide
- [MiPRO](/mipro) - Single-objective optimization
- [ACE](/ace) - Agentic Context Engineering
