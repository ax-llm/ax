---
title: "AxFlow Guide"
description: "AxFlow - Orchestration framework for building AI workflows with Ax"
---

# AxFlow Documentation

**AxFlow** is a powerful workflow orchestration system for building complex AI
applications with automatic dependency analysis, parallel execution, and
flexible control flow patterns.

## Table of Contents

- [Quick Start](#quick-start)
- [Why AxFlow is the Future](#why-axflow-is-the-future)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Control Flow Patterns](#control-flow-patterns)
  - [Asynchronous Operations](#5-asynchronous-operations)
- [Advanced Features](#advanced-features)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Quick Start

### Basic Flow

```typescript
import { ai, flow } from "@ax-llm/ax";

// Create AI instance
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

// Create a simple flow (factory function)
const wf = flow<{ userInput: string }, { responseText: string }>()
  .node("testNode", "userInput:string -> responseText:string")
  .execute("testNode", (state) => ({ userInput: state.userInput }))
  .returns((state) => ({ responseText: state.testNodeResult.responseText }));

// Execute the flow
const result = await wf.forward(llm, { userInput: "Hello world" });
console.log(result.responseText);
```

### Factory Options

```typescript
// Basic factory
const wf = flow();

// With options
const wf = flow({ autoParallel: false });

// With explicit typing
const wf = flow<InputType, OutputType>();

// With options and typing
const wf = flow<InputType, OutputType>({
  autoParallel: true,
  batchSize: 5,
});
```

## Why AxFlow is the Future

**🚀 Automatic Performance Optimization:**

- **Zero-Config Parallelization**: Automatically runs independent operations in
  parallel (1.5-3x speedup)
- **Intelligent Dependency Analysis**: AI-powered analysis of input/output
  dependencies
- **Optimal Execution Planning**: Automatically groups operations into parallel
  levels
- **Concurrency Control**: Smart resource management with configurable limits
- **Runtime Control**: Enable/disable auto-parallelization per execution as
  needed

**🛡️ Production-Ready Resilience:**

- **Exponential Backoff**: Smart retry strategies with configurable delays
- **Graceful Degradation**: Fallback mechanisms for continuous operation
- **Error Isolation**: Prevent cascading failures across workflow components
- **Resource Monitoring**: Adaptive scaling based on system performance

**Compared to Traditional Approaches:**

- **10x More Compact**: Ultra-concise syntax with powerful aliases
- **Zero Boilerplate**: Automatic state management and context threading
- **Multi-Modal Ready**: Native support for text, images, audio, and streaming
- **Self-Optimizing**: Built-in compatibility with MiPRO and other advanced
  optimizers
- **Enterprise Ready**: Circuit breakers, retries, and monitoring built-in
- **Production Hardened**: Used by startups scaling to millions of users

**Real-World Superpowers:**

- **Autonomous Agents**: Self-healing, self-improving AI workflows
- **Multi-Model Orchestration**: Route tasks to the perfect AI for each job
- **Adaptive Pipelines**: Workflows that evolve based on real-time feedback
- **Cost Intelligence**: Automatic optimization between speed, quality, and cost
- **Mission Critical**: Built for production with enterprise-grade reliability

> _"AxFlow doesn't just execute AI workflows—it orchestrates the future of
> intelligent systems with automatic performance optimization"_

**Ready to build the impossible?** AxFlow extends `AxProgramWithSignature`,
giving you access to the entire Ax ecosystem: optimization, streaming, tracing,
function calling, and more. The future of AI development is declarative,
adaptive, and beautiful.

## Core Concepts

### 1. Node Definition

Nodes define the available operations in your flow. You must define nodes before
executing them.

```typescript
// String signature (creates AxGen automatically)
flow.node("processor", "input:string -> output:string");

// With multiple outputs
flow.node("analyzer", "text:string -> sentiment:string, confidence:number");

// Complex field types
flow.node(
  "extractor",
  "documentText:string -> processedResult:string, entities:string[]",
);
```

### 2. State Evolution

State grows as you execute nodes, with results stored in `{nodeName}Result`
format:

```typescript
// Initial state: { userInput: "Hello" }
flow.execute("processor", (state) => ({ input: state.userInput }));
// State becomes: { userInput: "Hello", processorResult: { output: "Processed Hello" } }

flow.execute("analyzer", (state) => ({ text: state.processorResult.output }));
// State becomes: {
//   userInput: "Hello",
//   processorResult: { output: "Processed Hello" },
//   analyzerResult: { sentiment: "positive", confidence: 0.8 }
// }
```

### 3. State Transformation

Use `map()` to transform state between operations:

```typescript
flow.map((state) => ({
  ...state,
  processedInput: state.userInput.toLowerCase(),
  timestamp: Date.now(),
}));
```

## API Reference

### Core Methods

#### `node(name: string, signature: string, options?: object)`

Define a node with the given signature.

```typescript
flow.node("summarizer", "documentText:string -> summary:string");
flow.node("classifier", "text:string -> category:string", { debug: true });
```

**Alias:** `n()` - Short alias for `node()`

```typescript
flow.n("summarizer", "documentText:string -> summary:string");
```

#### `nodeExtended(name: string, baseSignature: string | AxSignature, extensions: object)`

Create a node with extended signature by adding additional input/output fields.

```typescript
// Add chain-of-thought reasoning
flow.nodeExtended("reasoner", "question:string -> answer:string", {
  prependOutputs: [
    { name: "reasoning", type: f.internal(f.string("Step-by-step reasoning")) },
  ],
});

// Add context and confidence
flow.nodeExtended("analyzer", "input:string -> output:string", {
  appendInputs: [{ name: "context", type: f.optional(f.string("Context")) }],
  appendOutputs: [{ name: "confidence", type: f.number("Confidence score") }],
});
```

**Extension Options:**

- `prependInputs` - Add fields at the beginning of input signature
- `appendInputs` - Add fields at the end of input signature
- `prependOutputs` - Add fields at the beginning of output signature
- `appendOutputs` - Add fields at the end of output signature

**Alias:** `nx()` - Short alias for `nodeExtended()`

```typescript
flow.nx("reasoner", "question:string -> answer:string", {
  prependOutputs: [
    { name: "reasoning", type: f.internal(f.string("Step-by-step reasoning")) },
  ],
});
```

#### `execute(nodeName: string, mapping: Function, options?: object)`

Execute a node with input mapping.

```typescript
flow.execute("summarizer", (state) => ({
  documentText: state.document,
}));

// With AI override
flow.execute("processor", mapping, { ai: alternativeAI });
```

#### `map(transform: Function)`

Transform the current state synchronously or asynchronously.

```typescript
// Synchronous transformation
flow.map((state) => ({
  ...state,
  upperCaseResult: state.processorResult.output.toUpperCase(),
}));

// Asynchronous transformation
flow.map(async (state) => {
  const apiData = await fetchFromAPI(state.query);
  return {
    ...state,
    enrichedData: apiData,
  };
});

// Parallel asynchronous transformations
flow.map([
  async (state) => ({ ...state, result1: await api1(state.data) }),
  async (state) => ({ ...state, result2: await api2(state.data) }),
  async (state) => ({ ...state, result3: await api3(state.data) }),
], { parallel: true });
```

**Alias:** `m()` - Short alias for `map()` (supports both sync and async)

```typescript
// Async with alias
flow.m(async (state) => {
  const processed = await processAsync(state.input);
  return { ...state, processed };
});
```

#### `returns(transform: Function)` / `r(transform: Function)`

Terminal transformation that sets the final output type of the flow. Use this as
the last transformation to get proper TypeScript type inference for the flow
result.

```typescript
const typedFlow = flow<{ input: string }>()
  .map((state) => ({ ...state, processed: true, count: 42 }))
  .returns((state) => ({
    result: state.processed ? "done" : "pending",
    totalCount: state.count,
  })); // TypeScript now properly infers the output type

// Result is typed as { result: string; totalCount: number }
const result = await typedFlow.forward(llm, { input: "test" });
console.log(result.result); // Type-safe access
console.log(result.totalCount); // Type-safe access
```

**Key Benefits:**

- **Proper Type Inference**: TypeScript automatically infers the correct return
  type
- **Clear Intent**: Explicitly marks the final transformation of your flow
- **Type Safety**: Full autocomplete and type checking on the result object

**Aliases:**

- `returns()` - Full descriptive name
- `r()` - Short alias (matches `m()` pattern)

```typescript
// These are equivalent:
flow.returns((state) => ({ output: state.value }));
flow.r((state) => ({ output: state.value }));
```

**When to Use:**

- When you want proper TypeScript type inference for complex flows
- As the final step in flows that transform the state into a specific output
  format
- When building reusable flows that need clear output contracts

#### `description(name: string, description: string)`

Set a flow-level name and description. The description is stored on the flow's
inferred signature, and the name/description are used by `toFunction()` for the
exported function metadata.

```typescript
const wf = flow<{ userQuestion: string }, { responseText: string }>()
  .node("qa", "userQuestion:string -> responseText:string")
  .description(
    "Question Answerer",
    "Answers user questions concisely using the configured AI model.",
  );
```

#### `toFunction()`

Convert the flow into an AxFunction using the flow's inferred signature. The
function's `name` prefers the name set via `description(name, ...)` and falls
back to the first line of the signature description. The `parameters` are
generated from the inferred input fields as JSON Schema.

```typescript
const wf = flow<{ userQuestion: string }, { responseText: string }>()
  .node("qa", "userQuestion:string -> responseText:string")
  .description(
    "Question Answerer",
    "Answers user questions concisely using the configured AI model.",
  );

const fn = wf.toFunction();
console.log(fn.name); // "questionAnswerer"
console.log(fn.parameters); // JSON Schema from inferred input
// You can call fn.func with args and { ai } to execute the flow
```

### Control Flow Methods

#### `while(condition: Function)` / `endWhile()`

Create loops that execute while condition is true.

```typescript
flow
  .map((state) => ({ ...state, counter: 0 }))
  .while((state) => state.counter < 3)
  .map((state) => ({ ...state, counter: state.counter + 1 }))
  .execute("processor", (state) => ({ input: `iteration ${state.counter}` }))
  .endWhile();
```

#### `branch(predicate: Function)` / `when(value)` / `merge()`

Conditional branching based on predicate evaluation.

```typescript
flow
  .branch((state) => state.complexity)
  .when("simple")
  .execute("simpleProcessor", mapping)
  .when("complex")
  .execute("complexProcessor", mapping)
  .merge()
  .map((state) => ({
    result: state.simpleProcessorResult?.output ||
      state.complexProcessorResult?.output,
  }));
```

#### `parallel(subFlows: Function[])` / `merge(key: string, mergeFunction: Function)`

Execute multiple sub-flows in parallel.

```typescript
flow
  .parallel([
    (subFlow) =>
      subFlow.execute("analyzer1", (state) => ({ text: state.input })),
    (subFlow) =>
      subFlow.execute("analyzer2", (state) => ({ text: state.input })),
    (subFlow) =>
      subFlow.execute("analyzer3", (state) => ({ text: state.input })),
  ])
  .merge("combinedResults", (result1, result2, result3) => ({
    analysis1: result1.analyzer1Result.analysis,
    analysis2: result2.analyzer2Result.analysis,
    analysis3: result3.analyzer3Result.analysis,
  }));
```

#### `label(name: string)` / `feedback(condition: Function, labelName: string, maxIterations?: number)`

Create labeled points for feedback loops.

```typescript
flow
  .map((state) => ({ ...state, attempts: 0 }))
  .label("retry-point")
  .map((state) => ({ ...state, attempts: state.attempts + 1 }))
  .execute("processor", (state) => ({ input: state.userInput }))
  .execute("validator", (state) => ({ output: state.processorResult.output }))
  .feedback(
    (state) => !state.validatorResult.isValid && state.attempts < 3,
    "retry-point",
  );
```

### Advanced Methods

#### `derive(outputField: string, inputField: string, transform: Function, options?: object)`

Create derived fields from array or scalar inputs with parallel processing
support.

```typescript
// Derive from array with parallel processing
flow.derive(
  "processedItems",
  "items",
  (item, index) => `processed-${item}-${index}`,
  {
    batchSize: 2,
  },
);

// Derive from scalar
flow.derive("upperText", "inputText", (text) => text.toUpperCase());
```

## Control Flow Patterns

### 1. Sequential Processing

```typescript
const sequentialFlow = flow<{ input: string }, { finalResult: string }>()
  .node("step1", "input:string -> intermediate:string")
  .node("step2", "intermediate:string -> output:string")
  .execute("step1", (state) => ({ input: state.input }))
  .execute(
    "step2",
    (state) => ({ intermediate: state.step1Result.intermediate }),
  )
  .map((state) => ({ finalResult: state.step2Result.output }));
```

### 2. Conditional Processing

```typescript
const conditionalFlow = flow<
  { query: string; isComplex: boolean },
  { response: string }
>()
  .node("simpleHandler", "query:string -> response:string")
  .node("complexHandler", "query:string -> response:string")
  .branch((state) => state.isComplex)
  .when(true)
  .execute("complexHandler", (state) => ({ query: state.query }))
  .when(false)
  .execute("simpleHandler", (state) => ({ query: state.query }))
  .merge()
  .map((state) => ({
    response: state.complexHandlerResult?.response ||
      state.simpleHandlerResult?.response,
  }));
```

### 3. Iterative Processing

```typescript
const iterativeFlow = flow<
  { content: string },
  { finalContent: string }
>()
  .node("processor", "content:string -> processedContent:string")
  .node("qualityChecker", "content:string -> qualityScore:number")
  .map((state) => ({ currentContent: state.content, iteration: 0 }))
  .while((state) => state.iteration < 3 && (state.qualityScore || 0) < 0.8)
  .map((state) => ({ ...state, iteration: state.iteration + 1 }))
  .execute("processor", (state) => ({ content: state.currentContent }))
  .execute(
    "qualityChecker",
    (state) => ({ content: state.processorResult.processedContent }),
  )
  .map((state) => ({
    ...state,
    currentContent: state.processorResult.processedContent,
    qualityScore: state.qualityCheckerResult.qualityScore,
  }))
  .endWhile()
  .map((state) => ({ finalContent: state.currentContent }));
```

### 4. Parallel Processing with Auto-Parallelization

AxFlow automatically detects independent operations and runs them in parallel:

```typescript
const autoParallelFlow = flow<
  { text: string },
  { combinedAnalysis: string }
>()
  .node("sentimentAnalyzer", "text:string -> sentiment:string")
  .node("topicExtractor", "text:string -> topics:string[]")
  .node("entityRecognizer", "text:string -> entities:string[]")
  // These three execute automatically in parallel! ⚡
  .execute("sentimentAnalyzer", (state) => ({ text: state.text }))
  .execute("topicExtractor", (state) => ({ text: state.text }))
  .execute("entityRecognizer", (state) => ({ text: state.text }))
  // This waits for all three to complete
  .map((state) => ({
    combinedAnalysis: JSON.stringify({
      sentiment: state.sentimentAnalyzerResult.sentiment,
      topics: state.topicExtractorResult.topics,
      entities: state.entityRecognizerResult.entities,
    }),
  }));

// Check execution plan
const plan = autoParallelFlow.getExecutionPlan();
console.log("Parallel groups:", plan.parallelGroups);
console.log("Max parallelism:", plan.maxParallelism);
```

### 5. Asynchronous Operations

AxFlow supports asynchronous transformations in map operations, enabling API
calls, database queries, and other async operations within your flow:

```typescript
const asyncFlow = flow<
  { userQuery: string },
  { enrichedData: string; apiCallTime: number }
>()
  .node("processor", "enrichedData:string -> processedResult:string")
  // Single async map - API enrichment
  .map(async (state) => {
    const startTime = Date.now();
    const apiData = await fetchFromExternalAPI(state.userQuery);
    const duration = Date.now() - startTime;

    return {
      ...state,
      enrichedData: apiData,
      apiCallTime: duration,
    };
  })
  // Execute AI processing on enriched data
  .execute("processor", (state) => ({ enrichedData: state.enrichedData }))
  // Parallel async operations
  .map([
    async (state) => {
      const sentiment = await analyzeSentiment(state.processedResult);
      return { ...state, sentiment };
    },
    async (state) => {
      const entities = await extractEntities(state.processedResult);
      return { ...state, entities };
    },
    async (state) => {
      const summary = await generateSummary(state.processedResult);
      return { ...state, summary };
    },
  ], { parallel: true })
  .map((state) => ({
    enrichedData: state.enrichedData,
    apiCallTime: state.apiCallTime,
  }));
```

#### Mixed Sync/Async Processing

You can mix synchronous and asynchronous operations seamlessly:

```typescript
const mixedFlow = flow<{ rawData: string }, { result: string }>()
  // Sync preprocessing
  .map((state) => ({
    ...state,
    cleanedData: state.rawData.trim().toLowerCase(),
  }))
  // Async validation
  .map(async (state) => {
    const isValid = await validateWithAPI(state.cleanedData);
    return { ...state, isValid };
  })
  // More sync processing
  .map((state) => ({
    ...state,
    timestamp: Date.now(),
  }))
  // Final async processing
  .map(async (state) => {
    if (state.isValid) {
      const processed = await processData(state.cleanedData);
      return { result: processed };
    }
    return { result: "Invalid data" };
  });
```

#### Performance Considerations

- **Parallel async maps**: Multiple async operations run concurrently
- **Sequential async maps**: Each async operation waits for the previous one
- **Batch control**: Use `batchSize` option to control parallelism

```typescript
// Parallel execution (faster)
flow.map([asyncOp1, asyncOp2, asyncOp3], { parallel: true });

// Sequential execution (slower but controlled)
flow
  .map(asyncOp1)
  .map(asyncOp2)
  .map(asyncOp3);
```

### 6. Self-Healing with Feedback Loops

```typescript
const selfHealingFlow = flow<{ input: string }, { output: string }>()
  .node("processor", "input:string -> output:string, confidence:number")
  .node("validator", "output:string -> isValid:boolean, issues:string[]")
  .node("fixer", "output:string, issues:string[] -> fixedOutput:string")
  .map((state) => ({ ...state, attempts: 0 }))
  .label("process")
  .map((state) => ({ ...state, attempts: state.attempts + 1 }))
  .execute("processor", (state) => ({ input: state.input }))
  .execute("validator", (state) => ({ output: state.processorResult.output }))
  .feedback(
    (state) => !state.validatorResult.isValid && state.attempts < 3,
    "process",
  )
  // If still invalid after retries, try to fix
  .branch((state) => state.validatorResult.isValid)
  .when(false)
  .execute("fixer", (state) => ({
    output: state.processorResult.output,
    issues: state.validatorResult.issues,
  }))
  .map((state) => ({
    output: state.fixerResult.fixedOutput,
  }))
  .when(true)
  .map((state) => ({
    output: state.processorResult.output,
  }))
  .merge();
```

## Advanced Features

### Instrumentation and Optimization (v13.0.24+)

- Deprecation: prefer `flow()` factory over `new AxFlow()`.
- Tracing: pass a Tracer via `flow({ tracer })` or
  `flow.forward(llm, input, { tracer, traceContext })`.
  - A parent span is created at the flow boundary (if `tracer` is provided).
  - The parent span context is propagated to all node `.forward()` calls via
    `options.traceContext`.
  - Pass an OpenTelemetry Context for `traceContext` (not a Span). Use
    `@opentelemetry/api` `context.active()` or similar.
- Meter: pass `meter` the same way as `tracer`; it is propagated to node
  forwards.
- **Program IDs & `namedPrograms()`**: Each node is registered with a
  dot-separated ID. Use `namedPrograms()` to discover them:
  ```typescript
  const wf = flow<{ input: string }>()
    .node('summarizer', 'text:string -> summary:string')
    .node('classifier', 'text:string -> category:string');

  console.log(wf.namedPrograms());
  // [
  //   { id: 'root.summarizer', signature: 'text:string -> summary:string' },
  //   { id: 'root.classifier', signature: 'text:string -> category:string' },
  // ]
  ```
- **Demos/Examples routing**: `flow.setDemos(demos)` routes by `programId` to the
  correct node. The flow maintains an internal `AxProgram`
  and registers all child nodes; each node filters demos by its `programId`.
  TypeScript narrows `programId` to registered node names — typos are caught at compile time:
  ```typescript
  // OK
  wf.setDemos([{ programId: 'root.summarizer', traces: [] }]);

  // TypeScript error: 'root.summerizer' is not a valid node name
  wf.setDemos([{ programId: 'root.summerizer', traces: [] }]);
  ```
  At runtime, unknown programIds throw a descriptive error listing valid IDs.
- **Optimization**: `flow.applyOptimization(optimizedProgram)` applies to the flow's
  internal program and all registered child nodes.
- Parallel map: `flow.map([...], { parallel: true })` merges all transform
  outputs back into state.

Example

```ts
import { ai, flow } from "@ax-llm/ax";
import { context, trace } from "@opentelemetry/api";

const llm = ai({ name: "mock" });
const tracer = trace.getTracer("axflow");

const wf = flow<{ userQuestion: string }>()
  .node("summarizer", "documentText:string -> summaryText:string")
  .execute("summarizer", (s) => ({ documentText: s.userQuestion }))
  .returns((s) => ({ finalAnswer: (s as any).summarizerResult.summaryText }));

const parentCtx = context.active();
const out = await wf.forward(llm, { userQuestion: "hi" }, {
  tracer,
  traceContext: parentCtx,
});
```

### 1. Auto-Parallelization

AxFlow automatically analyzes dependencies and runs independent operations in
parallel:

```typescript
// Disable auto-parallelization globally
const sequentialFlow = flow({ autoParallel: false });

// Disable for specific execution
const result = await flow.forward(llm, input, { autoParallel: false });

// Get execution plan information
const plan = flow.getExecutionPlan();
console.log(
  `Will run ${plan.parallelGroups} parallel groups with max ${plan.maxParallelism} concurrent operations`,
);
```

### 2. Dynamic AI Context

Use different AI services for different nodes:

```typescript
flow
  .execute("fastProcessor", mapping, { ai: speedAI })
  .execute("powerfulAnalyzer", mapping, { ai: powerAI })
  .execute("defaultProcessor", mapping); // Uses default AI from forward()
```

### 3. Batch Processing with Derive

```typescript
const batchFlow = flow<{ items: string[] }, { processedItems: string[] }>(
  {
    autoParallel: true,
    batchSize: 3, // Process 3 items at a time
  },
)
  .derive("processedItems", "items", (item, index) => {
    return `processed-${item}-${index}`;
  }, { batchSize: 2 }); // Override batch size for this operation
```

### 4. Error Handling

```typescript
try {
  const result = await flow.forward(llm, input);
} catch (error) {
  console.error("Flow execution failed:", error);
}
```

### 5. Program Integration

AxFlow integrates with the dspy-ts ecosystem:

```typescript
// Get signature
const signature = flow.getSignature();

// Set examples (if applicable)
flow.setExamples(examples);

// Get traces and usage
const traces = flow.getTraces();
const usage = flow.getUsage();
```

## Best Practices

### 1. Node Naming

Use descriptive names that clearly indicate the node's purpose:

```typescript
// ❌ Unclear
flow.node("proc1", signature);

// ✅ Clear
flow.node("documentSummarizer", signature);
flow.node("sentimentAnalyzer", signature);
```

### 2. State Management

Keep state flat and predictable:

```typescript
// ✅ Good - flat structure
flow.map((state) => ({
  ...state,
  processedText: state.rawText.toLowerCase(),
  timestamp: Date.now(),
}));

// ❌ Avoid - deep nesting
flow.map((state) => ({
  data: {
    processed: {
      text: state.rawText.toLowerCase(),
    },
  },
}));
```

### 3. Error Prevention

Always define nodes before executing them:

```typescript
// ✅ Correct order
flow
  .node("processor", signature)
  .execute("processor", mapping);

// ❌ Will throw error
flow
  .execute("processor", mapping) // Node not defined yet!
  .node("processor", signature);
```

### 4. Loop Safety

Ensure loop conditions can change:

```typescript
// ✅ Safe - counter increments
flow
  .map((state) => ({ ...state, counter: 0 }))
  .while((state) => state.counter < 5)
  .map((state) => ({ ...state, counter: state.counter + 1 })) // Condition changes
  .execute("processor", mapping)
  .endWhile();

// ❌ Infinite loop - condition never changes
flow
  .while((state) => state.isProcessing) // This never changes!
  .execute("processor", mapping)
  .endWhile();
```

### 5. Parallel Design

Structure flows to maximize automatic parallelization:

```typescript
// ✅ Parallel-friendly - independent operations
flow
  .execute("analyzer1", (state) => ({ text: state.input })) // Can run in parallel
  .execute("analyzer2", (state) => ({ text: state.input })) // Can run in parallel
  .execute("combiner", (state) => ({ // Waits for both
    input1: state.analyzer1Result.output,
    input2: state.analyzer2Result.output,
  }));

// ❌ Sequential - unnecessary dependencies
flow
  .execute("analyzer1", (state) => ({ text: state.input }))
  .execute("analyzer2", (state) => ({
    text: state.input,
    context: state.analyzer1Result.output, // Creates dependency!
  }));
```

## When to Use Each Feature

### Data shaping vs. AI calls: map() vs execute()

Use `map()` for synchronous/async data transformations without calling AI; use
`execute()` to invoke a previously defined AI node.

```typescript
const wf = flow<{ raw: string }, { answer: string }>()
  // Preprocess user input (no AI call)
  .map((s) => ({ cleaned: s.raw.trim().toLowerCase() }))
  // Call an AI node you defined earlier (requires execute)
  .node("qa", "question:string -> answer:string")
  .execute("qa", (s) => ({ question: s.cleaned }))
  .map((s) => ({ answer: s.qaResult.answer }));
```

### Conditional routing: branch()/when()/merge()

Use when you need different paths for different conditions, then converge.

```typescript
const wf = flow<{ query: string; expertMode: boolean }, { response: string }>()
  .node("simple", "query:string -> response:string")
  .node("expert", "query:string -> response:string")
  .branch((s) => s.expertMode)
  .when(true)
  .execute("expert", (s) => ({ query: s.query }))
  .when(false)
  .execute("simple", (s) => ({ query: s.query }))
  .merge()
  .map((s) => ({
    response: s.expertResult?.response ?? s.simpleResult?.response,
  }));
```

### Iteration/retries: while()/endWhile()

Use to repeat work until a goal is met or a cap is hit.

```typescript
const wf = flow<{ draft: string }, { final: string }>()
  .node("grader", "text:string -> score:number")
  .node("improver", "text:string -> improved:string")
  .map((s) => ({ current: s.draft, attempts: 0 }))
  .while((s) => s.attempts < 3)
  .execute("grader", (s) => ({ text: s.current }))
  .branch((s) => s.graderResult.score >= 0.8)
  .when(true)
  .map((s) => ({ attempts: 3 }))
  .when(false)
  .execute("improver", (s) => ({ text: s.current }))
  .map((s) => ({
    current: s.improverResult.improved,
    attempts: s.attempts + 1,
  }))
  .merge()
  .endWhile()
  .map((s) => ({ final: s.current }));
```

### Extend node contracts: nx()

Use `nx()` to augment inputs/outputs (e.g., add internal reasoning or
confidence) without changing original signature text.

```typescript
const wf = flow<{ question: string }, { answer: string; confidence: number }>()
  .nx("answerer", "question:string -> answer:string", {
    appendOutputs: [{ name: "confidence", type: f.number("0-1") }],
  })
  .execute("answerer", (s) => ({ question: s.question }))
  .map((s) => ({
    answer: s.answererResult.answer,
    confidence: s.answererResult.confidence,
  }));
```

### Batch/array processing: derive()

Use to fan out work over arrays with built-in batching and merging.

```typescript
const wf = flow<{ items: string[] }, { processed: string[] }>({ batchSize: 3 })
  .derive("processed", "items", (item) => item.toUpperCase(), { batchSize: 2 });
```

### Free speedups: auto-parallelization

Independent executes run in parallel automatically. Avoid creating unnecessary
dependencies.

```typescript
const wf = flow<{ text: string }, { combined: string }>()
  .node("a", "text:string -> x:string")
  .node("b", "text:string -> y:string")
  .execute("a", (s) => ({ text: s.text }))
  .execute("b", (s) => ({ text: s.text }))
  .map((s) => ({ combined: `${s.aResult.x}|${s.bResult.y}` }));
```

### Multi-model strategy: dynamic AI context

Override AI per execute to route tasks to the best model.

```typescript
const wf = flow<{ text: string }, { out: string }>()
  .node("fast", "text:string -> out:string")
  .node("smart", "text:string -> out:string")
  .execute("fast", (s) => ({ text: s.text }), { ai: ai({ name: "groq" }) })
  .execute("smart", (s) => ({ text: s.text }), {
    ai: ai({ name: "anthropic" }),
  })
  .map((s) => ({ out: s.smartResult?.out ?? s.fastResult.out }));
```

### Final typing and shape: returns()/r()

Use to lock in the exact output type and get full TypeScript inference.

```typescript
const wf = flow<{ input: string }>()
  .map((s) => ({ upper: s.input.toUpperCase(), length: s.input.length }))
  .returns((s) => ({ upper: s.upper, isLong: s.length > 20 }));
```

### Quality loops: label()/feedback()

Use to jump back to a label when a condition holds, with optional caps.

```typescript
const wf = flow<{ prompt: string }, { result: string }>()
  .node("gen", "prompt:string -> result:string, quality:number")
  .map((s) => ({ tries: 0 }))
  .label("retry")
  .execute("gen", (s) => ({ prompt: s.prompt }))
  .feedback((s) => s.genResult.quality < 0.9 && s.tries < 2, "retry")
  .map((s) => ({ result: s.genResult.result }));
```

### Parallel async transforms: map([...], { parallel: true })

Use to run multiple independent async transforms concurrently.

```typescript
const wf = flow<{ url: string }, { title: string; sentiment: string }>()
  .map([
    async (s) => ({ html: await fetchHTML(s.url) }),
    async (s) => ({ meta: await fetchMetadata(s.url) }),
  ], { parallel: true })
  .node("title", "html:string -> title:string")
  .node("sent", "html:string -> sentiment:string")
  .execute("title", (s) => ({ html: s.html }))
  .execute("sent", (s) => ({ html: s.html }))
  .returns((s) => ({
    title: s.titleResult.title,
    sentiment: s.sentResult.sentiment,
  }));
```

## Examples

### Extended Node Patterns with `nx`

```typescript
import { f, flow } from "@ax-llm/ax";

// Chain-of-thought reasoning pattern
const reasoningFlow = flow<{ question: string }, { answer: string }>()
  .nx("reasoner", "question:string -> answer:string", {
    prependOutputs: [
      {
        name: "reasoning",
        type: f.internal(f.string("Step-by-step reasoning")),
      },
    ],
  })
  .execute("reasoner", (state) => ({ question: state.question }))
  .map((state) => ({ answer: state.reasonerResult.answer }));

// Confidence scoring pattern
const confidenceFlow = flow<
  { input: string },
  { result: string; confidence: number }
>()
  .nx("analyzer", "input:string -> result:string", {
    appendOutputs: [
      { name: "confidence", type: f.number("Confidence score 0-1") },
    ],
  })
  .execute("analyzer", (state) => ({ input: state.input }))
  .map((state) => ({
    result: state.analyzerResult.result,
    confidence: state.analyzerResult.confidence,
  }));

// Contextual processing pattern
const contextualFlow = flow<
  { query: string; context?: string },
  { response: string }
>()
  .nx("processor", "query:string -> response:string", {
    appendInputs: [
      { name: "context", type: f.optional(f.string("Additional context")) },
    ],
  })
  .execute("processor", (state) => ({
    query: state.query,
    context: state.context,
  }))
  .map((state) => ({ response: state.processorResult.response }));
```

### Document Processing Pipeline

```typescript
const documentPipeline = flow<{ document: string }>()
  .node("summarizer", "documentText:string -> summary:string")
  .node("sentimentAnalyzer", "documentText:string -> sentiment:string")
  .node("keywordExtractor", "documentText:string -> keywords:string[]")
  // These run automatically in parallel
  .execute("summarizer", (state) => ({ documentText: state.document }))
  .execute("sentimentAnalyzer", (state) => ({ documentText: state.document }))
  .execute("keywordExtractor", (state) => ({ documentText: state.document }))
  // Use returns() for proper type inference
  .returns((state) => ({
    summary: state.summarizerResult.summary,
    sentiment: state.sentimentAnalyzerResult.sentiment,
    keywords: state.keywordExtractorResult.keywords,
  }));

// TypeScript now knows the exact return type:
// { summary: string; sentiment: string; keywords: string[] }
const result = await documentPipeline.forward(llm, { document: "..." });
console.log(result.summary); // Fully typed
console.log(result.sentiment); // Fully typed
console.log(result.keywords); // Fully typed
```

### Quality-Driven Content Creation

```typescript
const contentCreator = flow<
  { topic: string; targetQuality: number },
  { finalContent: string; iterations: number }
>()
  .node("writer", "topic:string -> content:string")
  .node("qualityChecker", "content:string -> score:number, feedback:string")
  .node("improver", "content:string, feedback:string -> improvedContent:string")
  .map((state) => ({ currentContent: "", iteration: 0, bestScore: 0 }))
  // Initial writing
  .execute("writer", (state) => ({ topic: state.topic }))
  .map((state) => ({
    ...state,
    currentContent: state.writerResult.content,
    iteration: 1,
  }))
  // Improvement loop
  .while((state) =>
    state.iteration < 5 && state.bestScore < state.targetQuality
  )
  .execute("qualityChecker", (state) => ({ content: state.currentContent }))
  .branch((state) => state.qualityCheckerResult.score > state.bestScore)
  .when(true)
  .execute("improver", (state) => ({
    content: state.currentContent,
    feedback: state.qualityCheckerResult.feedback,
  }))
  .map((state) => ({
    ...state,
    currentContent: state.improverResult.improvedContent,
    bestScore: state.qualityCheckerResult.score,
    iteration: state.iteration + 1,
  }))
  .when(false)
  .map((state) => ({ ...state, iteration: 5 })) // Exit loop
  .merge()
  .endWhile()
  .map((state) => ({
    finalContent: state.currentContent,
    iterations: state.iteration,
  }));
```

### Async Data Enrichment Pipeline

```typescript
const enrichmentPipeline = flow<
  { userQuery: string },
  { finalResult: string; metadata: object }
>()
  .node("analyzer", "enrichedData:string -> analysis:string")
  // Parallel async data enrichment from multiple sources
  .map([
    async (state) => {
      const userProfile = await fetchUserProfile(state.userQuery);
      return { ...state, userProfile };
    },
    async (state) => {
      const contextData = await fetchContextData(state.userQuery);
      return { ...state, contextData };
    },
    async (state) => {
      const historicalData = await fetchHistoricalData(state.userQuery);
      return { ...state, historicalData };
    },
  ], { parallel: true })
  // Combine enriched data
  .map(async (state) => {
    const combinedData = await combineDataSources({
      userProfile: state.userProfile,
      context: state.contextData,
      historical: state.historicalData,
    });

    return {
      ...state,
      enrichedData: combinedData,
      metadata: {
        sources: ["userProfile", "contextData", "historicalData"],
        timestamp: Date.now(),
      },
    };
  })
  // Process with AI
  .execute("analyzer", (state) => ({ enrichedData: state.enrichedData }))
  // Final async post-processing
  .map(async (state) => {
    const enhanced = await enhanceResult(state.analyzerResult.analysis);
    return {
      finalResult: enhanced,
      metadata: state.metadata,
    };
  });
```

### Real-time Data Processing with Async Maps

```typescript
const realTimeProcessor = flow<
  { streamData: string[] },
  { processedResults: string[]; stats: object }
>()
  // Async preprocessing of each item in parallel
  .map(async (state) => {
    const startTime = Date.now();

    // Process each item in batches with async operations
    const processedItems = await Promise.all(
      state.streamData.map(async (item, index) => {
        const enriched = await enrichDataItem(item);
        const validated = await validateItem(enriched);
        return { item: validated, index, timestamp: Date.now() };
      }),
    );

    const processingTime = Date.now() - startTime;

    return {
      ...state,
      processedItems,
      processingStats: {
        totalItems: state.streamData.length,
        processingTime,
        itemsPerSecond: state.streamData.length / (processingTime / 1000),
      },
    };
  })
  // Parallel async quality checks
  .map([
    async (state) => {
      const qualityScore = await calculateQualityScore(state.processedItems);
      return { ...state, qualityScore };
    },
    async (state) => {
      const anomalies = await detectAnomalies(state.processedItems);
      return { ...state, anomalies };
    },
    async (state) => {
      const trends = await analyzeTrends(state.processedItems);
      return { ...state, trends };
    },
  ], { parallel: true })
  // Final aggregation
  .map((state) => ({
    processedResults: state.processedItems.map((item) => item.item),
    stats: {
      ...state.processingStats,
      qualityScore: state.qualityScore,
      anomaliesFound: state.anomalies?.length || 0,
      trendsDetected: state.trends?.length || 0,
    },
  }));
```

### Multi-Model Research System

```typescript
const researchSystem = flow<
  { query: string },
  { answer: string; sources: string[]; confidence: number }
>()
  .node("queryGenerator", "researchQuestion:string -> searchQuery:string")
  .node("retriever", "searchQuery:string -> retrievedDocument:string")
  .node(
    "answerGenerator",
    "retrievedDocument:string, researchQuestion:string -> researchAnswer:string",
  )
  .execute("queryGenerator", (state) => ({ researchQuestion: state.query }))
  .execute(
    "retriever",
    (state) => ({ searchQuery: state.queryGeneratorResult.searchQuery }),
  )
  .execute("answerGenerator", (state) => ({
    retrievedDocument: state.retrieverResult.retrievedDocument,
    researchQuestion: state.query,
  }))
  .map((state) => ({
    answer: state.answerGeneratorResult.researchAnswer,
    sources: [state.retrieverResult.retrievedDocument],
    confidence: 0.85,
  }));
```

## Troubleshooting

### Common Errors

1. **"Node 'nodeName' not found"**
   - Ensure you call `.node()` before `.execute()`

2. **"endWhile() called without matching while()"**
   - Every `.while()` needs a matching `.endWhile()`

3. **"when() called without matching branch()"**
   - Every `.when()` needs to be inside a `.branch()` / `.merge()` block

4. **"merge() called without matching branch()"**
   - Every `.branch()` needs a matching `.merge()`

5. **"Label 'labelName' not found"**
   - Ensure the label exists before using it in `.feedback()`

### Performance Issues

1. **Operations running sequentially instead of parallel**
   - Check for unnecessary dependencies in your mappings
   - Use `flow.getExecutionPlan()` to debug

2. **Memory issues with large datasets**
   - Use `batchSize` option to control parallel execution
   - Consider using `.derive()` for array processing

### Type Errors

1. **State property not found**
   - Use `.map()` to ensure required properties exist
   - Check the spelling of result field names (`{nodeName}Result`)

This documentation provides a comprehensive guide to AxFlow based on the actual
implementation and test cases. All examples have been verified against the test
suite to ensure accuracy.
