---
name: ax-flow
description: This skill helps an LLM generate correct AxFlow workflow code using @ax-llm/ax. Use when the user asks about flow(), AxFlow, workflow orchestration, parallel execution, DAG workflows, conditional routing, map/reduce patterns, or multi-node AI pipelines.
version: "__VERSION__"
---

# AxFlow Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxFlow` workflow code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Use These Defaults

- Use `flow()` factory, not `new AxFlow()`.
- Import: `import { ai, flow, f } from '@ax-llm/ax';`
- `autoParallel: true` is the default; independent executes run in parallel automatically.
- Node results are stored as `${nodeName}Result` in state.
- Always define `.node()` before `.execute()` for that node.
- Use `.returns()` (or `.r()`) as the last step to lock the output type.
- Use descriptive node names: `documentSummarizer`, not `proc1`.
- Use descriptive field names: `userInput`, `responseText`, not `text`, `result`.

## Critical Rules

- Use `flow()` factory syntax for new code.
- Node results in state follow the pattern `state.${nodeName}Result.${fieldName}`.
- `.execute()` maps current state to node inputs; `.map()` transforms state without AI calls.
- `.returns()` maps final state to the flow output type.
- Always define nodes before executing them; reversed order throws at runtime.
- Keep state flat; avoid deep nesting in `.map()`.
- Ensure loop conditions can change to avoid infinite loops.
- Structure independent executes to maximize auto-parallelization.
- Use `flow<InputType, OutputType>()` for typed flows.
- Aliases: `.n()` = `.node()`, `.nx()` = `.nodeExtended()`, `.m()` = `.map()`, `.r()` = `.returns()`.

## Canonical Pattern

```typescript
import { ai, flow } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

const wf = flow<{ userInput: string }, { responseText: string }>()
  .node('testNode', 'userInput:string -> responseText:string')
  .execute('testNode', (state) => ({ userInput: state.userInput }))
  .returns((state) => ({ responseText: state.testNodeResult.responseText }));

const result = await wf.forward(llm, { userInput: 'Hello world' });
console.log(result.responseText);
```

## Factory Options

```typescript
// Basic
const wf = flow();

// With options
const wf = flow({ autoParallel: false });

// Typed
const wf = flow<InputType, OutputType>();

// Typed with options
const wf = flow<InputType, OutputType>({ autoParallel: true, batchSize: 5 });
```

## State Evolution

State grows with each executed node. Results are stored as `${nodeName}Result`:

```typescript
// Initial state: { userInput: 'Hello' }
flow.execute('processor', (state) => ({ input: state.userInput }));
// State: { userInput: 'Hello', processorResult: { output: '...' } }

flow.execute('analyzer', (state) => ({ text: state.processorResult.output }));
// State: { ..., analyzerResult: { sentiment: '...', confidence: 0.8 } }
```

## Node Definition

```typescript
// String signature (creates AxGen automatically)
flow.node('processor', 'input:string -> output:string');

// Multiple outputs
flow.node('analyzer', 'text:string -> sentiment:string, confidence:number');

// Array outputs
flow.node('extractor', 'documentText:string -> entities:string[]');

// Short alias
flow.n('processor', 'input:string -> output:string');
```

## Extended Nodes (nx)

Add fields to a base signature without rewriting it:

```typescript
import { f, flow } from '@ax-llm/ax';

// Chain-of-thought reasoning
flow.nx('reasoner', 'question:string -> answer:string', {
  prependOutputs: [
    { name: 'reasoning', type: f.internal(f.string('Step-by-step reasoning')) },
  ],
});

// Add confidence scoring
flow.nx('analyzer', 'input:string -> result:string', {
  appendOutputs: [{ name: 'confidence', type: f.number('Confidence 0-1') }],
});

// Add optional context input
flow.nx('processor', 'query:string -> response:string', {
  appendInputs: [{ name: 'context', type: f.optional(f.string('Extra context')) }],
});
```

Extension options: `prependInputs`, `appendInputs`, `prependOutputs`, `appendOutputs`.

## Execute With Input Mapping

```typescript
flow.execute('summarizer', (state) => ({ documentText: state.document }));

// With AI override (use a different model for this node)
flow.execute('processor', (state) => ({ input: state.data }), { ai: alternativeAI });
```

## Map (State Transformation)

Use `map()` for data shaping without AI calls:

```typescript
// Sync
flow.map((state) => ({ ...state, upperText: state.rawText.toUpperCase() }));

// Async
flow.map(async (state) => {
  const data = await fetchFromAPI(state.query);
  return { ...state, enrichedData: data };
});

// Parallel async transforms
flow.map([
  async (state) => ({ ...state, result1: await api1(state.data) }),
  async (state) => ({ ...state, result2: await api2(state.data) }),
], { parallel: true });
```

## Returns (Final Output)

```typescript
const wf = flow<{ input: string }>()
  .map((state) => ({ ...state, upper: state.input.toUpperCase(), len: state.input.length }))
  .returns((state) => ({ upper: state.upper, isLong: state.len > 20 }));

// Result is typed as { upper: string; isLong: boolean }
const result = await wf.forward(llm, { input: 'test' });
```

## Sequential Processing

```typescript
const wf = flow<{ input: string }, { finalResult: string }>()
  .node('step1', 'input:string -> intermediate:string')
  .node('step2', 'intermediate:string -> output:string')
  .execute('step1', (state) => ({ input: state.input }))
  .execute('step2', (state) => ({ intermediate: state.step1Result.intermediate }))
  .returns((state) => ({ finalResult: state.step2Result.output }));
```

## Auto-Parallel Execution

Independent executes run in parallel automatically (`autoParallel: true` by default):

```typescript
const wf = flow<{ text: string }, { combined: string }>()
  .node('sentimentAnalyzer', 'text:string -> sentiment:string')
  .node('topicExtractor', 'text:string -> topics:string[]')
  .node('entityRecognizer', 'text:string -> entities:string[]')
  // These three run in parallel (all depend only on state.text)
  .execute('sentimentAnalyzer', (state) => ({ text: state.text }))
  .execute('topicExtractor', (state) => ({ text: state.text }))
  .execute('entityRecognizer', (state) => ({ text: state.text }))
  // This waits for all three
  .returns((state) => ({
    combined: JSON.stringify({
      sentiment: state.sentimentAnalyzerResult.sentiment,
      topics: state.topicExtractorResult.topics,
      entities: state.entityRecognizerResult.entities,
    }),
  }));

// Inspect execution plan
const plan = wf.getExecutionPlan();
console.log(plan.parallelGroups, plan.maxParallelism);
```

Disable auto-parallel:

```typescript
const wf = flow({ autoParallel: false });
// or per execution:
await wf.forward(llm, input, { autoParallel: false });
```

## Conditional Branching

```typescript
const wf = flow<{ query: string; expertMode: boolean }, { response: string }>()
  .node('simple', 'query:string -> response:string')
  .node('expert', 'query:string -> response:string')
  .branch((state) => state.expertMode)
    .when(true)
      .execute('expert', (state) => ({ query: state.query }))
    .when(false)
      .execute('simple', (state) => ({ query: state.query }))
  .merge()
  .returns((state) => ({
    response: state.expertResult?.response ?? state.simpleResult?.response,
  }));
```

After `.merge()`, only the taken branch's result exists; use optional chaining (`?.`) on untaken branch results.

## While Loops

```typescript
const wf = flow<{ content: string }, { finalContent: string }>()
  .node('processor', 'content:string -> processedContent:string')
  .node('qualityChecker', 'content:string -> qualityScore:number')
  .map((state) => ({ currentContent: state.content, iteration: 0, qualityScore: 0 }))
  .while((state) => state.iteration < 3 && state.qualityScore < 0.8)
    .map((state) => ({ ...state, iteration: state.iteration + 1 }))
    .execute('processor', (state) => ({ content: state.currentContent }))
    .execute('qualityChecker', (state) => ({
      content: state.processorResult.processedContent,
    }))
    .map((state) => ({
      ...state,
      currentContent: state.processorResult.processedContent,
      qualityScore: state.qualityCheckerResult.qualityScore,
    }))
  .endWhile()
  .returns((state) => ({ finalContent: state.currentContent }));
```

Rules:
- Every `.while()` needs a matching `.endWhile()`.
- Ensure the loop condition can change to avoid infinite loops.

## Feedback Loops (label/feedback)

```typescript
const wf = flow<{ prompt: string }, { result: string }>()
  .node('gen', 'prompt:string -> result:string, quality:number')
  .map((state) => ({ ...state, tries: 0 }))
  .label('retry')
    .map((state) => ({ ...state, tries: state.tries + 1 }))
    .execute('gen', (state) => ({ prompt: state.prompt }))
  .feedback((state) => state.genResult.quality < 0.9 && state.tries < 3, 'retry')
  .returns((state) => ({ result: state.genResult.result }));
```

Rules:
- Define the label before referencing it in `.feedback()`.
- Always include a max-iteration guard to avoid infinite loops.

## Explicit Parallel Sub-Flows

```typescript
flow
  .parallel([
    (sub) => sub.execute('analyzer1', (state) => ({ text: state.input })),
    (sub) => sub.execute('analyzer2', (state) => ({ text: state.input })),
    (sub) => sub.execute('analyzer3', (state) => ({ text: state.input })),
  ])
  .merge('combinedResults', (r1, r2, r3) => ({
    a1: r1.analyzer1Result.analysis,
    a2: r2.analyzer2Result.analysis,
    a3: r3.analyzer3Result.analysis,
  }));
```

## Derive (Batch/Array Processing)

```typescript
const wf = flow<{ items: string[] }, { processed: string[] }>({ batchSize: 3 })
  .derive('processed', 'items', (item, index) => `processed-${item}-${index}`, {
    batchSize: 2,
  });
```

## Dynamic AI Context (Multi-Model)

Route nodes to different AI providers:

```typescript
const fast = ai({ name: 'groq', apiKey: '...' });
const smart = ai({ name: 'anthropic', apiKey: '...' });

const wf = flow<{ text: string }, { out: string }>()
  .node('draft', 'text:string -> out:string')
  .node('refine', 'text:string -> out:string')
  .execute('draft', (state) => ({ text: state.text }), { ai: fast })
  .execute('refine', (state) => ({ text: state.draftResult.out }), { ai: smart })
  .returns((state) => ({ out: state.refineResult.out }));
```

## Description and toFunction

```typescript
const wf = flow<{ userQuestion: string }, { responseText: string }>()
  .node('qa', 'userQuestion:string -> responseText:string')
  .execute('qa', (state) => ({ userQuestion: state.userQuestion }))
  .returns((state) => ({ responseText: state.qaResult.responseText }))
  .description('Question Answerer', 'Answers user questions concisely.');

const fn = wf.toFunction();
// fn.name, fn.parameters (JSON Schema), fn.func
```

## Instrumentation (Tracing)

```typescript
import { ai, flow } from '@ax-llm/ax';
import { context, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('axflow');
const llm = ai({ name: 'openai', apiKey: '...' });

const wf = flow<{ userQuestion: string }>()
  .node('summarizer', 'documentText:string -> summaryText:string')
  .execute('summarizer', (s) => ({ documentText: s.userQuestion }))
  .returns((s) => ({ answer: s.summarizerResult.summaryText }));

const result = await wf.forward(llm, { userQuestion: 'hi' }, {
  tracer,
  traceContext: context.active(),
});
```

## Program IDs and Demos

```typescript
const wf = flow<{ input: string }>()
  .node('summarizer', 'text:string -> summary:string')
  .node('classifier', 'text:string -> category:string');

// Discover program IDs
console.log(wf.namedPrograms());
// [{ id: 'root.summarizer', ... }, { id: 'root.classifier', ... }]

// Set demos (TypeScript catches typos)
wf.setDemos([{ programId: 'root.summarizer', traces: [] }]);

// Apply optimization
wf.applyOptimization(optimizedProgram);
```

## Error Handling

```typescript
try {
  const result = await wf.forward(llm, input);
} catch (error) {
  console.error('Flow execution failed:', error);
}
```

Common errors:
- `"Node 'x' not found"` -- define `.node()` before `.execute()`.
- `"endWhile() without matching while()"` -- every `.while()` needs `.endWhile()`.
- `"when() without matching branch()"` -- `.when()` must be inside `.branch()`/`.merge()`.
- `"merge() without matching branch()"` -- every `.branch()` needs `.merge()`.
- `"Label 'x' not found"` -- define `.label()` before `.feedback()` references it.

## Examples

Fetch these for full working code:

- [Flow](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow.ts) — complete flow usage
- [Auto-Parallel](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-auto-parallel.ts) — auto-parallelization
- [Async Map](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-async-map.ts) — async map transforms
- [Enhanced Demo](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-enhanced-demo.ts) — instance-based nodes
- [Flow as Function](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-to-function.ts) — flow as callable function
- [Fluent Builder](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/fluent-flow-example.ts) — fluent builder pattern
- [Flow Logging](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/flow-logging-simple.ts) — flow logging
- [Load Balancing](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/balancer.ts) — load balancing

## Do Not Generate

- Do not use `new AxFlow(...)` for new code.
- Do not execute a node before defining it with `.node()`.
- Do not use generic field names like `text`, `result`, `data`, `input`, `output`.
- Do not create deep-nested state objects in `.map()`.
- Do not create loop conditions that can never change.
- Do not add unnecessary dependencies between executes (kills auto-parallelism).
- Do not forget to use optional chaining on branch results after `.merge()`.
