---
name: ax-flow
description: This skill helps an LLM generate correct AxFlow workflow code using @ax-llm/ax. Use when the user asks about flow(), AxFlow, workflow orchestration, parallel execution, DAG workflows, conditional routing, map/reduce patterns, or multi-node AI pipelines.
version: "23.0.3"
---

# AxFlow Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxFlow` workflow code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Use These Defaults

- Use `flow()` factory, not `new AxFlow()`.
- Import: `import { ai, flow, f } from '@ax-llm/ax';`
- `autoParallel: true` is the default; independent executes and derives run in parallel when their metadata reads/writes are known and non-conflicting.
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
- Structure independent executes to maximize safe auto-parallelization.
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

### Rich Node Contracts (String Grammar)

Node signatures accept the full extended string grammar — constraint bags, class decisions, optional fields, and nested objects (full modifier table in the ax-signature skill):

```typescript
flow
  .node('triage', 'ticketText:string -> ticketClass:class "bug, billing, question", severityScore:number(min 1, max 5)')
  .node('draft', 'ticketText:string, ticketClass:string, severityScore:number -> replyText:string(max 400)')
  .node('audit', 'replyText:string -> approved:boolean, flaggedSpans:object{ spanText:string, reasonNote:string }[]');
```

- `class` is output-only: a downstream node consuming the decision declares it `:string`.
- Optional marks go on the name (`note?:string`), never after the type.
- `toString()` serializes these contracts losslessly into `%%ax` directives, so rich contracts survive the diagram round-trip.

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

Independent execute steps run in parallel automatically (`autoParallel: true` by default) when their metadata reads/writes are known and non-conflicting:

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

Planner rules:
- Independent `.execute()` and `.derive()` steps may parallelize.
- `.map()`, `.returns()`, `.branch()`, `.while()`, `.feedback()`, and explicit `.parallel()` are barriers.
- Branch, while, and feedback bodies still use the same planner internally.
- Use `autoParallel: false` when you need strict sequential execution.

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
const fast = ai({ name: 'openai', apiKey: '...', config: { model: 'gpt-5.4-mini' } });
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

Flow tracing also respects live app-wide defaults:

```typescript
import { axGlobals } from '@ax-llm/ax';
import { metrics } from '@opentelemetry/api';

axGlobals.tracer = tracer;
axGlobals.meter = metrics.getMeter('axflow');

const result = await wf.forward(llm, { userQuestion: 'hi' });
```

Rules:

- `wf.forward(..., { tracer, meter })` overrides flow defaults and `axGlobals`.
- Constructor/factory flow defaults override `axGlobals`.
- If no local tracer or meter is provided, `AxFlow` reads current `axGlobals.tracer` and `axGlobals.meter`, creates a parent flow span, and propagates tracer/meter plus trace context to node forwards.
- `axGlobals.abortSignal` is merged with flow-level abort signals.

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

For tuning a flow, use top-level `optimize(wf, train, metric, options)` from the
`ax-gepa` skill. There is no separate `flow.optimize(...)` helper.

## Chat Logs

`AxFlow.getChatLog()` returns a flat `readonly AxChatLogEntry[]` after `forward()`. Each child-node entry is tagged with `entry.name` so callers can filter by node:

```typescript
const log = wf.getChatLog();
for (const entry of log) {
  console.log(entry.name, entry.model);
}
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

## Native MCP/UCP

Use `ax-mcp` for MCP client construction, transport/authentication policy,
subscriptions, tasks, event routing, and replay. This section covers how Flow
inherits and coordinates the resulting live execution context.

Set `mcp`/`ucp` on the flow or a node. Sequential nodes reuse sessions; parallel nodes multiplex through each client's concurrency policy. Branch cancellation and flow aborts propagate to outstanding requests and newly created remote tasks. Structured protocol values stay structured in flow state.

```typescript
const wf = flow({ mcp: [inventory], ucp: [merchant] })
  .node('lookup', lookupProgram)
  .node('checkout', checkoutProgram, { mcpInheritance: ['merchant'] });
```

## Mermaid Source (Author or Serialize Flows)

A whole flow can be written as (or exported to) a mermaid flowchart. Pass the
diagram string straight to `flow()` — a string argument compiles the AxFlow
mermaid dialect into a runnable flow (an options object still constructs an
empty builder). `String(wf)` / `wf.toString()` renders any flow back, so
`flow(String(wf))` round-trips.

```typescript
import { flow } from '@ax-llm/ax';

const wf = flow<{ documentText: string }, { finalReport: string }>(`
flowchart TD
  %%ax summarize: documentText:string -> summaryText:string(max 500)
  %%ax check: summaryText:string -> verdict:class "pass, fail", note?:string
  %%ax format: summaryText:string, note?:string -> finalReport:string

  summarize[Summarize document] --> check{verdict}
  check -->|pass| format
  check -->|fail, max 3| summarize
`);

const { finalReport } = await wf.forward(llm, { documentText });
console.log(String(wf)); // render back to the same dialect
```

Dialect:
- `%%ax nodeId: <signature>` comment directives carry node contracts (mermaid renderers ignore them); the full string-signature grammar applies (`?` optional on the name, constraint bags, `object{ ... }`).
- Data auto-wires by field name: each node input binds to the nearest upstream node that outputs that field; a field no node produces becomes a flow input.
- A diamond `nodeId{field}` names a `class` decision; its labeled out-edges (`-->|pass|`) become branches. A back-edge is a loop: `-->|label, max N|` is feedback, `-->|while cond, max N|` is a while loop.

Render options and bindings:
- `wf.toString({ direction: 'LR' })` when you need render options; bare `String(wf)` uses defaults (`flowchart TD`).
- `bindings` supplies closures the dialect can't inline: `{ nodes: { normalize: (s) => ({...}) }, conditions: { keepGoing: (s) => ... } }` for map steps and `while` conditions.

### Flow Gallery

Every diagram below compiles with `flow(text)` as written (the while loop additionally needs its `conditions` binding).

Linear pipeline — three nodes auto-wired by field name:

```text
flowchart TD
  %%ax extract: contractText:string -> parties:string[], effectiveDate?:string(format date)
  %%ax summarize: contractText:string, parties:string[] -> summaryText:string(max 300)
  %%ax redline: summaryText:string -> riskNotes:string(item "one risk")[]

  extract --> summarize --> redline
```

Decision branch — a class diamond routes to per-branch responders, then re-joins:

```text
flowchart TD
  %%ax classify: requestText:string -> routeClass:class "support, sales"
  %%ax supportReply: requestText:string -> replyText:string(max 300)
  %%ax salesReply: requestText:string -> replyText:string(max 300)
  %%ax send: replyText:string -> deliveredReply:string

  classify{routeClass}
  classify -->|support| supportReply
  classify -->|sales| salesReply
  supportReply --> send
  salesReply --> send
```

Retry loop — a reviewer sends drafts back with a capped revise edge:

```text
flowchart TD
  %%ax draft: briefText:string -> articleText:string(max 800)
  %%ax review: articleText:string -> verdict:class "publish, revise", editorNote?:string
  %%ax publish: articleText:string, editorNote?:string -> finalPost:string

  draft --> review{verdict}
  review -->|publish| publish
  review -->|revise, max 2| draft
```

Fan-out / fan-in — two perspectives run in parallel, then a judge joins them:

```text
flowchart TD
  %%ax outline: topicText:string -> questionText:string
  %%ax proponent: questionText:string -> proArgument:string
  %%ax skeptic: questionText:string -> conArgument:string
  %%ax judge: proArgument:string, conArgument:string -> verdictSummary:string

  outline --> proponent & skeptic
  proponent & skeptic --> judge
```

While loop — repeat until a host-owned condition says stop (`flow(text, { conditions: { keepPolishing } })`):

```text
flowchart TD
  %%ax polish: draftText:string -> polishedText:string
  %%ax grade: polishedText:string -> qualityScore:number(min 0, max 1)

  polish --> grade
  grade -->|while keepPolishing, max 5| polish
```

Three-way branch and re-join — triage routes to one of three handlers before delivery:

```text
flowchart TD
  %%ax triage: ticketText:string -> ticketClass:class "bug, billing, question"
  %%ax bugHandler: ticketText:string -> replyText:string(max 300)
  %%ax billingHandler: ticketText:string -> replyText:string(max 300)
  %%ax questionHandler: ticketText:string -> replyText:string(max 300)
  %%ax send: replyText:string -> deliveredReply:string

  triage{ticketClass}
  triage -->|bug| bugHandler
  triage -->|billing| billingHandler
  triage -->|question| questionHandler
  bugHandler --> send
  billingHandler --> send
  questionHandler --> send
```

Judge panel — three independent drafts fan out, then converge on one verdict:

```text
flowchart TD
  %%ax outline: topicText:string -> outlineText:string
  %%ax draftA: outlineText:string -> draftAText:string
  %%ax draftB: outlineText:string -> draftBText:string
  %%ax draftC: outlineText:string -> draftCText:string
  %%ax judge: draftAText:string, draftBText:string, draftCText:string -> verdictText:string

  outline --> draftA & draftB & draftC
  draftA & draftB & draftC --> judge
```

Escalation ladder — a quality gate either sends the first answer or falls back to level two:

```text
flowchart TD
  %%ax l1Answer: ticketText:string -> answerText:string
  %%ax qualityGate: answerText:string -> verdict:class "pass, escalate"
  %%ax l2Answer: ticketText:string -> answerText:string
  %%ax send: answerText:string -> deliveredAnswer:string

  l1Answer --> qualityGate{verdict}
  qualityGate -->|pass| send
  qualityGate -->|escalate| l2Answer --> send
```

Itinerary planner — rich contracts stay attached to a simple linear graph:

```text
flowchart TD
  %%ax parse: requestText:string -> destinationName:string, stayWindow:dateRange, travelerCount:number(min 1, max 12), budgetUsd?:number(min 0)
  %%ax plan: destinationName:string, stayWindow:dateRange, travelerCount:number, budgetUsd?:number -> itineraryItems:object{ dayNumber:number(min 1), activityText:string }[]
  %%ax price: itineraryItems:object{ dayNumber:number, activityText:string }[], travelerCount:number -> estimatedTotalUsd:number(min 0), bookingNotes?:string(max 300)

  parse --> plan --> price
```

Fan-out with capped revision — two sections join, then review can send the assembly back twice:

```text
flowchart TD
  %%ax outline: briefText:string -> outlineText:string
  %%ax sectionA: outlineText:string -> sectionAText:string
  %%ax sectionB: outlineText:string -> sectionBText:string
  %%ax assemble: sectionAText:string, sectionBText:string -> articleText:string
  %%ax review: articleText:string -> verdict:class "approve, revise", reviewNote?:string
  %%ax publish: articleText:string, reviewNote?:string -> publishedArticle:string

  outline --> sectionA & sectionB
  sectionA & sectionB --> assemble --> review{verdict}
  review -->|approve| publish
  review -->|revise, max 2| assemble
```

## Examples

Fetch these for full working code:

- [Flow](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow.ts) — complete flow usage
- [Mermaid Flow](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-mermaid.ts) — author/serialize a flow as a mermaid diagram
- [Auto-Parallel](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-auto-parallel.ts) — auto-parallelization
- [Async Map](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-async-map.ts) — async map transforms
- [Enhanced Demo](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-enhanced-demo.ts) — instance-based nodes
- [Flow as Function](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/ax-flow-to-function.ts) — flow as callable function
- [Fluent Builder](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/fluent-flow-example.ts) — fluent builder pattern
- [Adaptive Provider Balancing](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/generation/adaptive-balancer.ts) — cost, deadline, reliability, and failover routing

## Event-Triggered Flows

An AxFlow is an `AxProgrammable` event target. The runtime maps an event into
the Flow's typed initial state and propagates `eventContext`, cancellation, and
idempotency metadata to every node. Abandoned branches still use normal Flow
cancellation semantics.

Task-backed MCP tools called by a Flow node register a continuation on the
shared event context. `axMCPEventRoutes` observes progress and resumes the Flow
on input-required or terminal task notifications.

For resource-driven wake, discover the endpoint with `inspectCatalog()` and
give `AxMCPEventSource` an explicit `resourceSubscriptions` policy. Managed
subscriptions reconcile list changes and reconnect separately from the Flow;
subscription alone never starts or resumes a Flow.

UCP lifecycle webhooks use the same continuation boundary through
`AxUCPWebhookEventSource`. Correlate on `ucp.checkout` or `ucp.order` only after
the signed request has been verified and mapped to application identity.

Use `eventTarget('id').program(flow).wakeInput(...).resumeInput(...)` when wake
and resume events have different shapes. Segment-safe `eventPath` mappings are
validated against the Flow signature before any node executes; a declarative
`.waitFor(kind, path)` creates the owned continuation consumed by the resume
route.

Reusable `eventInput()` plans are the preferred callback-free boundary.
Callback `mapInput` is normalized against the Flow signature before any node
runs. In generated hosts, immediate publications dispatch inline; the host uses
`nextDueAt()` and `runDue()` for delayed retries, debounce, and continuation
expiry.

## Do Not Generate

- Do not use `new AxFlow(...)` for new code.
- Do not execute a node before defining it with `.node()`.
- Do not use removed terminal shapers like `.mapOutput()` or `.mo()`.
- Do not rely on broad signature inference from arbitrary transform source. Use explicit input/output generics and `.returns()` for the final output contract.
- Do not use generic field names like `text`, `result`, `data`, `input`, `output`.
- Do not create deep-nested state objects in `.map()`.
- Do not create loop conditions that can never change.
- Do not add unnecessary dependencies between executes (kills auto-parallelism).
- Do not forget to use optional chaining on branch results after `.merge()`.
