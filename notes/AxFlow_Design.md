# AxFlow: The Missing DSPy Computational Graph

## Overview

AxFlow is a fluent, chainable API for building and orchestrating complex,
stateful AI programs within the Ax framework. It provides a declarative way to
define computational nodes and an imperative way to compose them using loops,
conditionals, and dynamic context switching.

## Why AxFlow is Needed

### The Problem: Complex AI Workflows Are Hard to Build

As AI applications become more sophisticated, developers face several challenges
when building complex workflows:

1. **State Management Complexity**: Traditional approaches require manual state
   threading between multiple AI operations, leading to verbose and error-prone
   code.

2. **Lack of Composability**: Existing solutions don't provide clean
   abstractions for composing multiple AI operations while maintaining type
   safety and readability.

3. **Dynamic Context Requirements**: Real-world applications often need to use
   different AI models for different tasks (e.g., a fast model for
   summarization, a powerful model for analysis), but current frameworks make
   this cumbersome.

4. **Control Flow Limitations**: Building workflows with loops, conditionals,
   and complex branching logic requires significant boilerplate code and state
   management.

5. **Reusability Challenges**: AI programs are difficult to decompose into
   reusable components that can be shared across different workflows.

### The Solution: AxFlow's Design Philosophy

AxFlow addresses these challenges through several key design principles:

**1. Declarative Node Definition + Imperative Composition**

```typescript
// Declare what you want to compute
.node('summarizer', 'text:string -> summary:string')
.node('analyzer', 'text:string -> analysis:string')

// Compose how you want to compute it
.execute('summarizer', state => ({ text: state.input }))
.execute('analyzer', state => ({ text: state.input }))
```

**2. Fluent Interface for Readability** The entire workflow reads like a natural
description of the process, making it easy to understand and maintain.

**3. Dynamic Context Switching** Different parts of the workflow can use
different AI models without breaking the flow:

```typescript
.execute('summarizer', mapping, { ai: cheapAI })
.execute('analyzer', mapping, { ai: powerfulAI })
```

**4. Built-in Control Flow** Loops and conditionals are first-class citizens:

```typescript
.while(state => state.iterations < 3)
  .map(state => ({ ...state, iterations: state.iterations + 1 }))
.endWhile()
```

## Core Design Concepts

### 1. State-Centric Architecture

AxFlow is built around the concept of a flowing state object that gets
transformed through each step of the workflow. This design provides:

- **Immutability by Convention**: Each transformation returns a new state object
- **Full Context Preservation**: All intermediate results are maintained in the
  state
- **Flexible Data Flow**: State can be reshaped at any point using `.map()`

### 2. Node-Based Computation Model

Computational nodes are declared separately from their usage, providing:

- **Reusability**: Nodes can be used multiple times with different inputs
- **Type Safety**: Each node has a well-defined input/output signature
- **Testability**: Nodes can be tested in isolation
- **Performance**: Node generators are created once and reused

### 3. Multi-Modal Node Types

AxFlow supports four different ways to define nodes, enabling maximum
flexibility:

**String Signatures** (creates AxGen):

```typescript
.node('summarizer', 'text:string -> summary:string')
```

- Creates a new AxGen instance with the specified signature
- Standard approach for AI-powered operations

**AxSignature Instances** (creates AxGen):

```typescript
const sig = new AxSignature("text:string -> summary:string")
  .node("summarizer", sig, { debug: true });
```

- Creates a new AxGen instance using a pre-configured signature
- Useful for reusing signature configurations

**AxGen Instances** (uses directly):

```typescript
const summarizer = new AxGen("text:string -> summary:string", {
  temperature: 0.1,
})
  .node("summarizer", summarizer);
```

- Uses an existing AxGen instance directly
- Enables sharing pre-configured generators across flows

**AxFlow or AxAgent Classes** (uses directly):

```typescript
// Use AxAgent as a node
const agent = new AxAgent("userQuery:string -> agentResponse:string")
  .node("agent", agent);

// Use AxFlow as a node (sub-flow)
const subFlow = new AxFlow("input:string -> processedOutput:string")
  .node("processor", "input:string -> processed:string")
  .execute("processor", (s) => ({ input: s.input }))
  .map((s) => ({ processedOutput: s.processorResult.processed }))
  .node("subFlow", subFlow);
```

- Creates an instance of the custom class and uses it directly
- Enables non-AI operations, data processing, API calls, etc.
- **Key innovation**: Allows seamless mixing of AI and non-AI operations
- **Agent integration**: Use AxAgent for tool-based workflows
- **Flow composition**: Use AxFlow for complex sub-workflows

### 3. Context-Aware Execution

Each execution step can override the default AI service and options:

```typescript
.execute('node', mapping, { 
  ai: specializedAI, 
  options: { temperature: 0.1 } 
})
```

This enables:

- **Model Specialization**: Use the right model for each task
- **Cost Optimization**: Use cheaper models where appropriate
- **A/B Testing**: Compare different models in the same workflow

## Implementation Details

### Type System Design

AxFlow uses **four** TypeScript generic parameters to provide end-to-end type
safety while still keeping the API ergonomic:

```typescript
class AxFlow<
  IN extends AxGenIn,                                     // Input shape provided to .forward()
  OUT extends AxGenOut,                                   // Final output shape returned by .forward()
  TNodes extends Record<string, AxGen<any, any>> = Record<string, never>, // Compile-time registry of declared nodes
  TState extends AxFlowState = IN                         // Evolving state type that flows through the pipeline
>
```

- **`IN`** – The structure the caller must pass into `flow.forward(...)`.
- **`OUT`** – The structure the caller will receive back when the flow
  completes.
- **`TNodes`** – A **compile-time registry** that maps node names (strings) to
  their `AxGen` types. You almost never specify this yourself. Instead, every
  time you call `.node('name', signature)` the type system _returns a new AxFlow
  instance_ with `TNodes` augmented to include that node:

  ```typescript
  const flow = new AxFlow()
    .node("summarizer", "text:string -> summary:string")
    //      ^ TNodes is now { summarizer: AxGen<{text:string},{summary:string}> }
    .node("critic", "summary:string -> critique:string");
  //      ^ TNodes is now { summarizer: ..., critic: AxGen<...> }
  ```

  Because of this registry: • `flow.execute('summarizer', ...)` is allowed (name
  exists in `TNodes`).\
  • `flow.execute('oops', ...)` fails at compile time (name not in `TNodes`).

- **`TState`** – The _current_ shape of the flowing state object. It starts as
  `IN`, then evolves through every `.map()` and `.execute()` call:

  1. `map()` replaces the state with whatever you return.
  2. `execute('node', ...)` merges the node's result back in under the key
     `${node}Result`.

  Example evolution:

  ```typescript
  // IN is { topic: string }
  .map(s => ({ ...s, originalText: `About ${s.topic}` }))
  // TState ⇒ { topic: string, originalText: string }
  .execute('summarizer', s => ({ text: s.originalText }))
  // TState ⇒ { topic: string, originalText: string, summarizerResult: { summary: string } }
  ```

📌 **Key takeaway**: **You normally specify only the first two generics (`IN`,
`OUT`)**.\
`TNodes` and `TState` are _inferred and updated automatically_ as you chain
calls, giving you precise IntelliSense and compile-time safety without extra
boilerplate.

### State Management

The state object flows through the workflow and accumulates results:

```typescript
// Initial state: { topic: "AI" }
// After summarizer: { topic: "AI", summarizerResult: { summary: "..." } }
// After analyzer: { topic: "AI", summarizerResult: {...}, analyzerResult: { analysis: "..." } }
```

Node results are automatically namespaced using the pattern `${nodeName}Result`
to avoid conflicts.

### Loop Implementation

Loops are implemented using a stack-based approach:

1. `.while()` pushes a loop start marker onto the stack
2. Steps between `.while()` and `.endWhile()` are collected
3. `.endWhile()` pops the stack and creates the loop logic
4. The loop executes all collected steps repeatedly until the condition fails

### Node Signature Format

AxFlow uses the same string-based signature format as AxGen for consistency
across the Ax ecosystem:

```typescript
// Simple signature
.node('summarizer', 'text:string -> summary:string')

// Multiple outputs
.node('qualityCheck', 'query:string -> needsMoreInfo:boolean, confidence:number')

// Complex signatures
.node('synthesizer', 'userQuery:string, sources:string[] -> answer:string')
```

This maintains full compatibility with AxGen while providing a clean, readable
API.

## Architectural Benefits

### 1. Separation of Concerns

- **Declaration**: What computations are available (nodes)
- **Orchestration**: How computations are composed (flow)
- **Execution**: When and with what context (dynamic overrides)

### 2. Incremental Complexity

Workflows can start simple and grow in complexity:

```typescript
// Simple: Single node execution
const simple = new AxFlow()
  .node("processor", signature)
  .execute("processor", mapping);

// Complex: Multi-node with loops and dynamic context
const complex = new AxFlow()
  .node("summarizer", sig1)
  .node("analyzer", sig2)
  .while(condition)
  .execute("summarizer", mapping1, { ai: cheapAI })
  .execute("analyzer", mapping2, { ai: powerfulAI })
  .endWhile();
```

### 3. Performance Optimization

- **Node Reuse**: AxGen instances are created once and reused
- **Lazy Evaluation**: Only executes when `.forward()` is called
- **Efficient State Management**: State objects are passed by reference where
  possible

## Integration with Ax Ecosystem

AxFlow extends `AxProgramWithSignature`, making it compatible with:

- **Optimizers**: Can be tuned using MiPRO, Bootstrap Few Shot, etc.
- **Streaming**: Supports streaming execution through the underlying AxGen
  instances
- **Tracing**: Inherits OpenTelemetry support from the Ax ecosystem
- **Examples**: Can use examples and demonstrations like other Ax programs

## Use Cases and Patterns

### 1. Multi-Model Workflows

Using different AI models for different tasks:

```typescript
const workflow = new AxFlow()
  .node("draft", "topic:string -> content:string")
  .node("review", "content:string -> feedback:string")
  .node("finalize", "content:string, feedback:string -> final:string")
  .execute("draft", mapping, { ai: fastAI })
  .execute("review", mapping, { ai: expertAI })
  .execute("finalize", mapping, { ai: balancedAI });
```

### 2. Iterative Refinement

Loops for progressive improvement:

```typescript
const refiner = new AxFlow()
  .node("improve", "text:string -> improved:string")
  .while((state) => state.quality < 0.9)
  .execute("improve", (state) => ({ text: state.current }))
  .map((state) => ({ ...state, current: state.improveResult.improved }))
  .endWhile();
```

### 3. Conditional Branching

Different processing paths based on state using branching and dynamic context
overrides:

```typescript
const processor = new AxFlow<
  { text: string; type: string },
  { processorResult: { result: string } }
>()
  .node("processor", "text:string -> result:string")
  .branch((state) => state.type === "urgent")
  .when(true)
  .execute("processor", (state) => ({ text: state.text }), { ai: powerfulAI })
  .when(false)
  .execute("processor", (state) => ({ text: state.text }), { ai: basicAI })
  .merge<{ processorResult: { result: string } }>();
```

## API Reference

### Chainable Methods

AxFlow provides a comprehensive set of chainable methods for building complex AI
workflows. Each method returns a new AxFlow instance with updated type
information. **Short aliases** are provided for rapid development.

| Method                   | Alias             | Arguments                                                                                           | Description                                                                                                                                                        | Example                                                  |
| ------------------------ | ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **`node()`**             | **`n()`**         | `name: string`<br>`signature: string`<br>`options?: AxProgramForwardOptions`                        | Declares a reusable computational node with input/output signature. Adds the node to the TNodes registry for type safety.                                          | `flow.n('summarizer', 'text:string -> summary:string')`  |
| **`execute()`**          | **`e()`**         | `nodeName: keyof TNodes`<br>`mapping: (state) => nodeInput`<br>`dynamicContext?: { ai?, options? }` | Executes a previously defined node. The node name must exist in TNodes registry. Result is merged into state as `${nodeName}Result`.                               | `flow.e('summarizer', state => ({ text: state.input }))` |
| **`map()`**              | **`m()`**         | `transform: (state) => newState`                                                                    | Applies a synchronous transformation to the state object. Completely replaces the current state type.                                                              | `flow.m(state => ({ ...state, processed: true }))`       |
| **`branch()`**           | **`b()`**         | `predicate: (state) => value`                                                                       | Starts a conditional branch based on a predicate function. Must be followed by `when()` calls and closed with `merge()`.                                           | `flow.b(state => state.type)`                            |
| **`when()`**             | **`w()`**         | `value: any`                                                                                        | Defines a branch case for the current branch context. Executes steps when branch predicate equals this value.                                                      | `.w('urgent').e('fastProcessor', ...)`                   |
| **`merge()`**            | **`mg()`**        | `<TMergedState extends AxFlowState = TState>` optional                                              | Ends the current branch and merges all branch paths back into the main flow; you can optionally specify an explicit merged state type via `merge<TMergedState>()`. | `.mg<MyState>()`                                         |
| **`parallel()`**         | **`p()`**         | `branches: Array<(subFlow) => subFlow>`                                                             | Executes multiple operations in parallel. Returns an object with a `merge()` method for combining results.                                                         | `flow.p([subFlow => subFlow.e(...)])`                    |
| **`parallel().merge()`** | **`p().merge()`** | `resultKey: string`<br>`mergeFunction: (...results) => value`                                       | Merges parallel execution results into a single value under the specified key in state.                                                                            | `.merge('documents', (r1, r2) => [...r1, ...r2])`        |
| **`while()`**            | **`wh()`**        | `condition: (state) => boolean`<br>`maxIterations?: number`                                         | Marks the beginning of a loop block. Executes contained steps repeatedly while condition is true. Default max iterations is 100 to prevent infinite loops.         | `flow.wh(state => state.iterations < 3, 50)`             |
| **`endWhile()`**         | **`end()`**       | _(none)_                                                                                            | Marks the end of a loop block. Required to close every `while()` block.                                                                                            | `.end()`                                                 |
| **`label()`**            | **`l()`**         | `label: string`                                                                                     | Labels a step for later reference in feedback loops. Cannot be used inside branch blocks.                                                                          | `flow.l('retry-point')`                                  |
| **`feedback()`**         | **`fb()`**        | `condition: (state) => boolean`<br>`targetLabel: string`<br>`maxIterations?: number`                | Creates a feedback loop that jumps back to a labeled step if condition is met. Default max iterations is 10.                                                       | `flow.fb(state => state.quality < 0.7, 'retry-point')`   |
| **`forward()`**          | _(none)_          | `ai: AxAIService`<br>`values: IN`<br>`options?: AxProgramForwardOptions`                            | Executes the flow with the given AI service and input values. Returns a Promise resolving to the final output.                                                     | `await flow.forward(ai, { topic: 'AI' })`                |

### Type Evolution

The power of AxFlow lies in its sophisticated type system that evolves as you
build your workflow:

- **TNodes Registry**: Each `node()` call adds to the compile-time registry,
  enabling type-safe `execute()` calls
- **State Evolution**: Each `map()` and `execute()` call updates the TState
  type, providing accurate IntelliSense
- **Compile-time Validation**: Node names, input shapes, and state properties
  are all validated at compile time

### Control Flow Patterns

#### Basic Sequential Flow

```typescript
flow.node("step1", "input:string -> output1:string")
  .node("step2", "input:string -> output2:string")
  .execute("step1", (state) => ({ input: state.data }))
  .execute("step2", (state) => ({ input: state.step1Result.output1 }));
```

#### Conditional Branching

```typescript
flow.branch((state) => state.urgency)
  .when("high")
  .execute("fastProcessor", mapping)
  .when("low")
  .execute("thoroughProcessor", mapping)
  .merge();
```

#### Parallel Execution

```typescript
flow.parallel([
  (subFlow) => subFlow.execute("retriever1", mapping),
  (subFlow) => subFlow.execute("retriever2", mapping),
])
  .merge("allDocs", (docs1, docs2) => [...docs1, ...docs2]);
```

#### Loops with Feedback

```typescript
// Using while loop with iteration limit
flow.while((state) => state.score < 0.8, 10)
  .execute("generator", mapping)
  .execute("critic", mapping)
  .map((state) => ({ ...state, score: state.criticResult.score }))
  .endWhile();

// Using feedback loop
flow.label("improve")
  .execute("generator", mapping)
  .execute("critic", mapping)
  .feedback((state) => state.criticResult.score < 0.8, "improve", 5);
```

#### Compact Syntax with Aliases

```typescript
// Same logic as above but much more concise
const flow = new AxFlow()
  .n("gen", "prompt:string -> content:string")
  .n("check", "content:string -> score:number")
  .l("retry")
  .e("gen", (s) => ({ prompt: s.task }))
  .e("check", (s) => ({ content: s.genResult.content }))
  .fb((s) => s.checkResult.score < 0.8, "retry", 3);

// Branching with aliases
flow.b((s) => s.type)
  .w("urgent").e("fastProcessor", mapping).mg()
  .w("normal").e("standardProcessor", mapping).mg();
```

## Production-Ready Enhancements (Implemented)

### 1. Enhanced Branch Type Safety ✅ IMPLEMENTED

**Implementation**: Added optional explicit type parameters to `merge()`:

```typescript
// Enhanced API with explicit merged type support
flow.branch((state) => state.type)
  .when("simple").map((state) => ({
    result: state.simpleResult,
    method: "simple",
  }))
  .when("complex").map((state) => ({
    result: state.complexResult,
    method: "complex",
  }))
  .merge<{ result: string; method: string }>(); // Explicit merged state type now supported

// Runtime validation and compile-time type safety
interface MergedState {
  result: string;
  method: "fast" | "thorough";
  confidence: number;
}

const typeSafeFlow = new AxFlow<{ input: string }, MergedState>()
  .branch((state) => state.complexity)
  .when("high").execute("thoroughProcessor", mapping)
  .when("low").execute("fastProcessor", mapping)
  .merge<MergedState>(); // Full type safety with explicit merge types
```

### 2. Error Handling and Resilience ✅ IMPLEMENTED

**Implementation**: Comprehensive error handling with circuit breakers, retries,
and fallbacks:

```typescript
// Circuit breaker implementation
const resilientFlow = new AxFlow(signature, {
  errorHandling: {
    maxRetries: 3,
    backoffType: "exponential",
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxCalls: 3,
    },
    fallbackStrategy: "graceful",
  },
})
  // Per-operation error handling
  .execute("unreliableNode", mapping, {
    errorHandling: {
      retries: 3,
      backoffType: "exponential",
      onError: "continue",
      fallbackNode: "backupProcessor",
    },
  });
```

### 3. Performance Optimization ✅ IMPLEMENTED

**Implementation**: Concurrency control and resource-aware scheduling:

```typescript
// Concurrency and resource management
const optimizedFlow = new AxFlow(signature, {
  performance: {
    maxConcurrency: 5,
    resourceLimits: {
      tokensPerMinute: 50000,
      requestsPerSecond: 10,
      memoryLimitMB: 512,
    },
    adaptiveConcurrency: true,
    resourceMonitoring: {
      cpuThreshold: 80,
      memoryThreshold: 70,
      responseTimeThreshold: 5000,
    },
  },
})
  // Priority-based execution
  .execute("criticalTask", mapping, {
    priority: "critical",
    performance: {
      maxExecutionTimeMs: 30000,
      expectedComplexity: "high",
    },
  });
```

### 4. Instance-Based Node Definitions ✅ IMPLEMENTED

**Implementation**: Removed class constructor support, now requires instances:

```typescript
// Previous approach (deprecated)
.node('processor', ProcessorClass)  // ❌ No longer supported

// New approach (implemented)
.node('processor', new ProcessorClass())  // ✅ Instance-based
.node('subFlow', new AxFlow(...))         // ✅ Sub-flow composition
.node('agent', new AxAgent(...))          // ✅ Agent integration

// Enhanced type safety and performance with direct instance usage
const customProcessor = new CustomProcessor({ config: 'optimized' })
.node('processor', customProcessor)  // Reusable, configured instance
```

## Future Enhancements (Planned)

### 1. Advanced Parallel Execution Patterns

Enhanced parallel execution with dependency graphs:

```typescript
.parallelWithDependencies([
  { node: 'fetcher1', dependencies: [] },
  { node: 'fetcher2', dependencies: [] },
  { node: 'combiner', dependencies: ['fetcher1', 'fetcher2'] }
])
```

### 2. Conditional Execution Primitives

Native support for conditional node execution:

```typescript
.if(state => state.needsAnalysis)
  .execute('analyzer', mapping)
.endif()
```

### 3. Advanced Sub-Flow Patterns

Enhanced sub-flow composition with parameter passing:

```typescript
.subflow('preprocessing', preprocessingFlow, { 
  parameters: state => ({ config: state.userPreferences })
})
```

## Comparison to Alternatives

### vs. Direct AxGen Composition

**AxGen Approach:**

```typescript
const summarizer = new AxGen("text:string -> summary:string");
const analyzer = new AxGen("text:string -> analysis:string");

const text = input.topic;
const summaryResult = await summarizer.forward(ai, { text });
const analysisResult = await analyzer.forward(ai, { text });
const result = {
  summary: summaryResult.summary,
  analysis: analysisResult.analysis,
};
```

**AxFlow Approach:**

```typescript
const flow = new AxFlow()
  .node("summarizer", "text:string -> summary:string")
  .node("analyzer", "text:string -> analysis:string")
  .execute("summarizer", (state) => ({ text: state.topic }))
  .execute("analyzer", (state) => ({ text: state.topic }))
  .map((state) => ({
    summary: state.summarizerResult.summary,
    analysis: state.analyzerResult.analysis,
  }));

const result = await flow.forward(ai, input);
```

**AxFlow Benefits:**

- Declarative node definitions enable reusability
- Built-in state management
- Type safety throughout the flow
- Easy to add control flow (loops, conditions)
- Dynamic context switching
- Better composition and testing

### vs. Traditional Workflow Engines

Most workflow engines are designed for business processes, not AI operations.
AxFlow is specifically designed for:

- **AI-Native Operations**: Built-in support for LLM operations, streaming, and
  AI-specific patterns
- **Type Safety**: Full TypeScript support with compile-time checking
- **Fluent API**: More readable and maintainable than configuration-based
  approaches
- **Lightweight**: No external dependencies or complex runtime requirements

## Conclusion

AxFlow represents a significant step forward in building complex,
production-ready AI workflows. By combining declarative node definitions with
imperative composition, it provides the flexibility needed for sophisticated AI
applications while maintaining the simplicity and type safety that developers
expect.

The design prioritizes:

- **Developer Experience**: Fluent, readable API with instance-based definitions
- **Type Safety**: Full TypeScript support with enhanced merge type safety
- **Production Resilience**: Built-in circuit breakers, retries, and error
  handling
- **Performance Optimization**: Concurrency control and resource-aware
  scheduling
- **Flexibility**: Dynamic context switching and control flow
- **Ecosystem Integration**: Full compatibility with existing Ax features

**Production-Ready Features Implemented:**

✅ **Error Handling & Resilience**: Circuit breakers with configurable failure
thresholds, exponential backoff retry strategies, and graceful fallback
mechanisms

✅ **Performance Optimization**: Adaptive concurrency control, resource
monitoring, and priority-based execution scheduling

✅ **Enhanced Type Safety**: Explicit merge type parameters for complex
branching scenarios with compile-time validation

✅ **Instance-Based Architecture**: Removed class constructor support in favor
of direct instance usage for better performance and type safety

These enhancements transform AxFlow from a promising prototype into a
production-ready orchestration framework that can handle the demands of
enterprise AI applications. The combination of developer-friendly APIs with
robust error handling and performance optimization makes AxFlow suitable for
mission-critical AI workflows.

As AI applications continue to grow in complexity, AxFlow provides the
foundation for building maintainable, scalable, resilient, and powerful AI
workflows that can operate reliably in production environments.
