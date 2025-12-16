# GEPA: Multi-Objective Optimization

GEPA (Genetic Evolutionary Programming with Agents) provides multi-objective optimization for AI programs when you need to balance multiple competing goals.

## Table of Contents

- [What is Multi-Objective Optimization?](#what-is-multi-objective-optimization)
- [When to Use GEPA](#when-to-use-gepa)
- [Understanding Pareto Optimization](#understanding-pareto-optimization)
- [GEPA vs GEPA-Flow](#gepa-vs-gepa-flow)
- [Complete Working Example](#complete-working-example)
- [GEPA-Flow for Multi-Module Programs](#gepa-flow-for-multi-module-programs)
- [Advanced Multi-Objective Patterns](#advanced-multi-objective-patterns)
- [Understanding Results](#understanding-results)
- [Performance Considerations](#performance-considerations)
- [Tips for Success](#tips-for-success)

## What is Multi-Objective Optimization?

**The Problem**: Sometimes you care about multiple things at once - accuracy AND speed AND cost. Traditional optimization only handles one objective at a time.

**The Solution**: Use `AxGEPA` (single-module) or `AxGEPAFlow` (multi-module) with a multi-objective metric. Both use `compile(...)` and return a Pareto frontier of trade-offs plus hypervolume metrics.

**NEW in v14.0.24+**: GEPA now returns the same unified `optimizedProgram` interface as MiPRO, enabling consistent save/load/apply workflows across all optimizers.

> Note: Pass `maxMetricCalls` in `compile` options to bound evaluation cost.

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

## GEPA vs GEPA-Flow

- **AxGEPA**: Optimizes a single program/module with multiple objectives
- **AxGEPAFlow**: Optimizes multi-step pipelines (flows) with multiple objectives

Both return a Pareto frontier of solutions and use the same unified `optimizedProgram` interface.

## Complete Working Example

**GEPA now returns the same unified `optimizedProgram` interface as MiPRO**, making save/load/apply workflows consistent across optimizers.

> **📖 Full Example**: For a comprehensive multi-objective optimization demonstration, see `src/examples/gepa-quality-vs-speed-optimization.ts` which shows GEPA optimizing code review quality vs speed trade-offs with detailed Pareto frontier analysis.

```typescript
import { ai, ax, AxGEPA, AxOptimizedProgramImpl, AxAIOpenAIModel } from "@ax-llm/ax";

// Two-objective demo: accuracy (classification) + brevity (short rationale)
const moderator = ax(`
  userPost:string "User content" ->
  isSafe:class "safe, unsafe" "Safety",
  rationale:string "One concise sentence"
`);

const train = [
  { userPost: "Great weather today!", isSafe: "safe" },
  { userPost: "This product sucks and the company is terrible!", isSafe: "unsafe" },
  // ...
];

const val = [
  { userPost: "Reminder: submit timesheets", isSafe: "safe" },
  { userPost: "Data breach follow-up actions required", isSafe: "unsafe" },
  // ...
];

// Multi-objective metric
const multiMetric = ({ prediction, example }: any) => {
  const accuracy = prediction?.isSafe === example?.isSafe ? 1 : 0;
  const rationale: string = typeof prediction?.rationale === 'string' ? prediction.rationale : '';
  const len = rationale.length;
  const brevity = len <= 30 ? 1 : len <= 60 ? 0.7 : len <= 100 ? 0.4 : 0.1;
  return { accuracy, brevity } as Record<string, number>;
};

const student = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY!, config: { model: AxAIOpenAIModel.GPT4OMini } });
const optimizer = new AxGEPA({ studentAI: student, numTrials: 16, minibatch: true, minibatchSize: 6, seed: 42, verbose: true });

console.log("🔄 Finding Pareto trade-offs...");
const result = await optimizer.compile(
  moderator as any,
  train,
  multiMetric as any,
  {
    validationExamples: val,
    feedbackExamples: val,
    feedbackFn: ({ prediction, example }) =>
      prediction?.isSafe === example?.isSafe
        ? '✅ Matched label'
        : [
            `Expected: ${example?.isSafe ?? 'unknown'}`,
            `Received: ${prediction?.isSafe ?? 'unknown'}`,
          ],
    // Required to bound evaluation cost
    maxMetricCalls: 200,
    // Optional: provide a tie-break scalarizer for selection logic
    // paretoMetricKey: 'accuracy',
    // or
    // paretoScalarize: (s) => 0.7*s.accuracy + 0.3*s.brevity,
  }
);

console.log(`✅ Found ${result.paretoFrontSize} Pareto points`);
console.log(`📊 Hypervolume (2D): ${result.hypervolume ?? 'N/A'}`);

// Inspect a few points
for (const [i, p] of [...result.paretoFront].entries()) {
  if (i >= 3) break;
  console.log(`  #${i+1}: acc=${(p.scores as any).accuracy?.toFixed(3)}, brev=${(p.scores as any).brevity?.toFixed(3)}, config=${JSON.stringify(p.configuration)}`);
}

// **NEW: GEPA now provides unified optimizedProgram interface**
if (result.optimizedProgram) {
  // Apply optimization using the same pattern as MiPRO
  moderator.applyOptimization(result.optimizedProgram);

  console.log(`✨ Applied GEPA optimization:`);
  console.log(`   Score: ${result.optimizedProgram.bestScore.toFixed(3)}`);
  console.log(`   Optimizer: ${result.optimizedProgram.optimizerType}`); // "GEPA"
  console.log(`   Converged: ${result.optimizedProgram.converged ? "✅" : "❌"}`);

  // Save the complete GEPA optimization (same as MiPRO format)
  await fs.writeFile(
    "gepa-optimization.json",
    JSON.stringify({
      version: "2.0",
      bestScore: result.optimizedProgram.bestScore,
      instruction: result.optimizedProgram.instruction,
      demos: result.optimizedProgram.demos,
      examples: result.optimizedProgram.examples, // GEPA includes training examples
      modelConfig: result.optimizedProgram.modelConfig,
      optimizerType: result.optimizedProgram.optimizerType,
      optimizationTime: result.optimizedProgram.optimizationTime,
      totalRounds: result.optimizedProgram.totalRounds,
      converged: result.optimizedProgram.converged,
      stats: result.optimizedProgram.stats,
      timestamp: new Date().toISOString(),
    }, null, 2)
  );

  // Load and apply later (same pattern as MiPRO)
  // const savedData = JSON.parse(await fs.readFile('gepa-optimization.json', 'utf8'));
  // const optimizedProgram = new AxOptimizedProgramImpl(savedData);
  // moderator.applyOptimization(optimizedProgram);
} else {
  // Fallback: choose a compromise by weighted sum
  const weights = { accuracy: 0.7, brevity: 0.3 };
  const best = result.paretoFront.reduce((best, cur) => {
    const s = weights.accuracy * ((cur.scores as any).accuracy ?? 0) + weights.brevity * ((cur.scores as any).brevity ?? 0);
    const b = weights.accuracy * ((best.scores as any).accuracy ?? 0) + weights.brevity * ((best.scores as any).brevity ?? 0);
    return s > b ? cur : best;
  });
  console.log(`🎯 Chosen config: ${JSON.stringify(best.configuration)}`);
}
```

> 💡 **Feedback hook**: `feedbackFn` lets you surface rich guidance for each evaluation, whether it's a short string or multiple bullet points. The hook receives the raw `prediction` and original `example`, making it easy to emit reviewer-style comments alongside scores. Pair it with `feedbackExamples` to keep cost-efficient review sets separate from validation metrics.

## GEPA-Flow for Multi-Module Programs

```typescript
import { AxGEPAFlow, flow, ai } from "@ax-llm/ax";

const pipeline = flow<{ emailText: string }>()
  .n('classifier', 'emailText:string -> priority:class "high, normal, low"')
  .n('rationale', 'emailText:string, priority:string -> rationale:string "One concise sentence"')
  .e('classifier', (s) => ({ emailText: s.emailText }))
  .e('rationale', (s) => ({ emailText: s.emailText, priority: s.classifierResult.priority }))
  .m((s) => ({ priority: s.classifierResult.priority, rationale: s.rationaleResult.rationale }));

const optimizer = new AxGEPAFlow({ studentAI: ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY!, config: { model: AxAIOpenAIModel.GPT4OMini } }), numTrials: 16 });
const result = await optimizer.compile(pipeline as any, train, multiMetric as any, { validationExamples: val, maxMetricCalls: 240 });
console.log(`Front size: ${result.paretoFrontSize}, Hypervolume: ${result.hypervolume}`);
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

### Customer Satisfaction vs Efficiency

```typescript
const multiMetric = ({ prediction, example }) => ({
  customerSatisfaction: calculateSatisfactionScore(prediction, example),
  resourceEfficiency: 1 / (prediction.processingSteps || 1),
  resolutionSpeed: prediction.resolutionTime
    ? (1 / prediction.resolutionTime)
    : 0,
});
```

## Understanding Results

```typescript
const result = await optimizer.compile(program, examples, multiMetric, { maxMetricCalls: 200 });

// Key properties of AxParetoResult:
console.log(`Pareto frontier size: ${result.paretoFrontSize}`);
console.log(`Best scalarized score on frontier: ${result.bestScore}`);
console.log(`Hypervolume (2D only): ${result.hypervolume}`);
console.log(`Total candidates evaluated: ${result.finalConfiguration?.candidates}`);

// Each frontier solution contains:
result.paretoFront.forEach((solution) => {
  solution.scores; // Scores for each objective
  solution.configuration; // Candidate identifier for this solution
  solution.dominatedSolutions; // How many others this point dominates
});
```

## Performance Considerations

- **Runtime**: GEPA/GEPA-Flow perform reflective evolution with Pareto sampling; time scales with `numTrials`, validation size, and `maxMetricCalls`.
- **Cost**: Bound evaluations with `maxMetricCalls`; consider minibatching.
- **Scalability**: Works best with 2–4 objectives; hypervolume reporting is 2D.
- **Determinism**: Provide `seed` for reproducibility; `tieEpsilon` resolves near-ties.

## Tips for Success

1. **Start with 2-3 objectives**: More objectives make selection harder.
2. **Scale objectives similarly (0–1)** for fair comparison.
3. **Use `paretoMetricKey` or `paretoScalarize`** to guide selection/tie-breaks.
4. **Validate chosen trade-offs** on a holdout set aligned to business constraints.
5. **Keep validation small** to control cost; use `validationExamples` and `feedbackExamples` splits.

## See Also

- [OPTIMIZE.md](OPTIMIZE.md) - Main optimization guide
- [MIPRO.md](MIPRO.md) - MiPRO optimizer documentation
- [ACE.md](ACE.md) - Agentic Context Engineering
- `src/examples/gepa-quality-vs-speed-optimization.ts` - Complete working example
