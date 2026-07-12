---
name: ax-llm
description: This skill helps with using the @ax-llm/ax TypeScript library for building LLM applications. Use when the user asks about ax(), ai(), f(), s(), agent(), flow(), AxGen, AxAgent, AxFlow, signatures, streaming, or mentions @ax-llm/ax.
version: "__VERSION__"
---

# Ax Library (@ax-llm/ax) Quick Reference

Ax is a TypeScript library for building LLM-powered applications with type-safe signatures, streaming support, and multi-provider compatibility.

> **Detailed skills available:** ax-ai (providers), ax-signature (signatures/types), ax-gen (generators), ax-agent (core agents/tools), ax-agent-rlm (agent runtime/RLM/delegation), ax-agent-observability (callbacks/logs/usage), ax-agent-memory-skills (recall and dynamic skill loading), ax-agent-optimize (agent tuning/eval), ax-flow (workflows), ax-gepa (top-level `optimize(...)`, BootstrapFewShot -> GEPA, Pareto optimization).

## Imports & Factories

```typescript
// Prefer factory functions: ax(), ai(), agent(), flow(); avoid class constructors.
import { ax, ai, f, s, fn, agent, flow, AxMemory, AxMCPClient } from '@ax-llm/ax';
import { z } from 'zod'; // optional — any Standard Schema v1 library works

// AI provider
const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY });

// Generator (from string signature)
const gen = ax('question:string -> answer:string');

// Generator (from fluent signature)
const gen = ax(
  f()
    .input('question', f.string('User question'))
    .output('answer', f.string('AI response'))
    .build()
);

// Generator (from zod — Standard Schema v1, also works with valibot/arktype)
const zodGen = ax(
  f()
    .input(z.object({ question: z.string().describe('User question') }))
    .output(z.object({ answer: z.string().describe('AI response') }))
    .build()
);

// Reusable signature
const sig = s('question:string, context:string[] -> answer:string');

// Agent
const myAgent = agent('userInput:string -> response:string', {
  name: 'helper',
  description: 'A helpful assistant',
});

// Flow
const wf = flow<{ input: string }, { output: string }>()
  .node('step1', 'input:string -> output:string')
  .execute('step1', (state) => ({ input: state.input }))
  .returns((state) => ({ output: state.step1Result.output }));

// Function tool — native fluent
const tool = fn('search')
  .description('Search the web')
  .arg('query', f.string('Search query'))
  .returns(f.string('Search results'))
  .handler(({ query }) => searchWeb(query))
  .build();

// Function tool — zod schema (Standard Schema v1: also works with valibot, arktype)
const zodTool = fn('calculateTax')
  .description('Calculate tax for an amount')
  .arg(z.object({
    amount: z.number().positive().describe('Pre-tax amount in USD'),
    region: z.enum(['US', 'EU', 'UK']).describe('Tax region'),
  }))
  .returns(z.object({ tax: z.number(), total: z.number() }))
  .handler(async ({ amount }) => ({ tax: amount * 0.1, total: amount * 1.1 }))
  .build();
```

## Running

```typescript
// Forward (blocking)
const result = await gen.forward(llm, { question: 'What is 2+2?' });

// Streaming
for await (const chunk of gen.streamingForward(llm, { question: 'Tell a story' })) {
  if (chunk.delta.answer) process.stdout.write(chunk.delta.answer);
}
```

## Forward Options Quick Reference

| Goal | Option | Example |
|------|--------|---------|
| Model override | `model` | `{ model: 'gpt-5.4-mini' }` |
| Temperature | `modelConfig.temperature` | `{ modelConfig: { temperature: 0.8 } }` |
| Max tokens | `modelConfig.maxTokens` | `{ modelConfig: { maxTokens: 500 } }` |
| Retry on failure | `maxRetries` | `{ maxRetries: 3 }` |
| Max agent steps | `maxSteps` | `{ maxSteps: 10 }` |
| Fail fast | `fastFail` | `{ fastFail: true }` |
| Thinking budget | `thinkingTokenBudget` | `{ thinkingTokenBudget: 'medium' }` |
| Show thoughts | `showThoughts` | `{ showThoughts: true }` |
| Context caching | `contextCache` | `{ contextCache: { cacheBreakpoint: 'after-examples' } }` |
| Multi-sampling | `sampleCount` | `{ sampleCount: 5 }` |
| Debug logging | `debug` | `{ debug: true }` |
| Abort signal | `abortSignal` | `{ abortSignal: controller.signal }` |
| Memory | `mem` | `{ mem: new AxMemory() }` |
| Stop function | `stopFunction` | `{ stopFunction: 'finalAnswer' }` |
| Function mode | `functionCallMode` | `{ functionCallMode: 'auto' }` |

Global runtime defaults can be set with `axGlobals` and are read live by future AI, AxGen, and AxFlow calls:

```typescript
import { axGlobals, axCreateDefaultColorLogger } from '@ax-llm/ax';
import { trace } from '@opentelemetry/api';

axGlobals.tracer = trace.getTracer('my-app');
axGlobals.debug = true;
axGlobals.logger = axCreateDefaultColorLogger();
```

Precedence is: per-call options, then explicit instance/program options, then current `axGlobals`, then built-in defaults. `customLabels` merge in that order, and `abortSignal` values are combined so either global or local cancellation works.

## Memory and Context

```typescript
import { AxMemory } from '@ax-llm/ax';

const memory = new AxMemory();

// Multi-turn conversation
await gen.forward(llm, { userMessage: 'My name is Alice' }, { mem: memory });
const r = await gen.forward(llm, { userMessage: 'What is my name?' }, { mem: memory });
```

## Few-Shot Examples

```typescript
const classifier = ax('reviewText:string -> sentiment:class "positive, negative, neutral"');

classifier.setExamples([
  { reviewText: 'I love this!', sentiment: 'positive' },
  { reviewText: 'Terrible.', sentiment: 'negative' },
  { reviewText: 'It works.', sentiment: 'neutral' },
]);
```

## Common Patterns

### Classification

```typescript
const classifier = ax(
  f()
    .input('text', f.string())
    .output('category', f.class(['spam', 'ham', 'uncertain']))
    .output('confidence', f.number().min(0).max(1))
    .build()
);
```

### Extraction

```typescript
const extractor = ax(
  f()
    .input('text', f.string())
    .output('entities', f.object({
      people: f.string().array(),
      organizations: f.string().array(),
      locations: f.string().array()
    }))
    .build()
);
```

### Multi-modal (Images)

```typescript
const analyzer = ax(
  f()
    .input('image', f.image('Image to analyze'))
    .input('question', f.string('Question').optional())
    .output('description', f.string())
    .output('objects', f.string().array())
    .build()
);

const result = await analyzer.forward(llm, {
  image: { mimeType: 'image/jpeg', data: base64Data },
  question: 'What objects are in this image?'
});
```

### Chaining Generators

```typescript
const researcher = ax('topic:string -> research:string, keyFacts:string[]');
const writer = ax('research:string, keyFacts:string[] -> article:string');

const research = await researcher.forward(llm, { topic: 'AGI' });
const draft = await writer.forward(llm, { research: research.research, keyFacts: research.keyFacts });
```

## Error Handling

```typescript
import { AxGenerateError, AxAIServiceError, AxAIServiceAbortedError } from '@ax-llm/ax';

try {
  const result = await gen.forward(llm, { input: 'test' });
} catch (error) {
  if (error instanceof AxGenerateError) {
    console.error('Generation failed:', error.details.model, error.details.signature);
  } else if (error instanceof AxAIServiceAbortedError) {
    console.log('Request was aborted');
  } else if (error instanceof AxAIServiceError) {
    console.error('AI service error:', error.message);
  }
}
```

## Debugging

```typescript
import { axCreateDefaultColorLogger, axGlobals } from '@ax-llm/ax';

const result = await gen.forward(llm, { input: 'test' }, {
  debug: true,
  logger: axCreateDefaultColorLogger(),
  // OpenTelemetry
  tracer: openTelemetryTracer,
  meter: openTelemetryMeter,
});

// Or set live app-wide defaults for future calls:
axGlobals.tracer = openTelemetryTracer;
axGlobals.meter = openTelemetryMeter;
```

## MCP Integration

Use the `ax-mcp` skill for the complete native client, transport,
authentication, catalog, task, subscription, event, and replay workflow.

```typescript
import { AxMCPClient, agent } from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

// Stdio transport (local MCP server)
const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
});

const mcpClient = new AxMCPClient(transport, { namespace: 'memory' });

// Native MCP context is initialized once and inherited by all agent stages.
const myAgent = agent('userMessage:string -> response:string', {
  mcp: mcpClient,
  functionDiscovery: true,
  contextFields: [],
});

const result = await myAgent.forward(llm, { userMessage: 'Remember this.' });
await mcpClient.close(); // caller-owned clients remain caller-owned
```

### HTTP Transport (Remote MCP)

```typescript
import { AxMCPStreamableHTTPTransport } from '@ax-llm/ax';

const transport = new AxMCPStreamableHTTPTransport('https://remote.example/mcp', {
  headers: { 'x-pd-project-id': projectId },
  authorization: `Bearer ${accessToken}`,
});
```

### Native MCP and UCP behavior

- Pass `mcp` and `ucp` to AxGen, streaming AxGen, chat, AxAgent, AxFlow, optimization, or evaluation options.
- Use `mcpContext` to inject attributed prompts/resources before the first model call.
- Use `mcpInheritance: 'all' | 'none' | string[]` to restrict child programs.
- Tool calls retain raw MCP content, metadata, errors, tasks, and protocol provenance in memory.
- AxAgent exposes native modules as `mcp.<namespace>` and `ucp.<namespace>`.
- `toFunction()` remains a compatibility adapter only; native Ax execution never uses it.
- Live optimization is rejected by default. Use recording/replay or explicitly opt into live MCP evaluation.

```typescript
const tools = mcpClient.getTools();
const prompts = await mcpClient.listPrompts();
const resource = await mcpClient.readResource('docs://guide');
const tasks = await mcpClient.listTasks();
```

### Function Overrides

```typescript
const mcpClient = new AxMCPClient(transport, {
  functionOverrides: [
    { name: 'search_documents', updates: { name: 'findDocs', description: 'Search docs' } }
  ]
});
```

## Type Reference

```typescript
class AxGen<IN, OUT> {
  forward(ai: AxAIService, values: IN, options?: AxProgramForwardOptions): Promise<OUT>;
  streamingForward(ai: AxAIService, values: IN, options?: AxProgramStreamingForwardOptions): AsyncGenerator<{ delta: Partial<OUT> }>;
  setExamples(examples: Array<Partial<IN & OUT>>): void;
  addAssert(fn: (output: OUT) => boolean | string | undefined | Promise<boolean | string | undefined>, message?: string): void;
  addStreamingAssert(field: keyof OUT, fn: (chunk: string, done?: boolean) => boolean | string | undefined | Promise<boolean | string | undefined>, message?: string): void;
  addFieldProcessor(field: keyof OUT, fn: (value: any) => any): void;
  addStreamingFieldProcessor(field: keyof OUT, fn: (chunk: string, ctx: any) => void): void;
  stop(): void;
}

class AxAgent<IN, OUT> {
  forward(ai: AxAIService, values: IN, options?: AxAgentOptions): Promise<OUT>;
  streamingForward(ai: AxAIService, values: IN, options?: AxAgentOptions): AsyncGenerator<{ delta: Partial<OUT> }>;
  getFunction(): AxFunction;
}

class AxFlow<IN, OUT> {
  node(name: string, signature: string | AxSignature): AxFlow;
  execute(name: string, mapper: (state) => any): AxFlow;
  returns(mapper: (state) => OUT): AxFlow;
  forward(ai: AxAIService, values: IN): Promise<OUT>;
}
```

## Event-Driven Programs

Use `eventRuntime()` when notifications, webhooks, timers, or remote tasks
should wake or resume an Ax program. Sources publish into an inbox; explicit
routes choose `observe`, `invalidate`, `wake`, or `resume`. Event payloads are
never inserted as user messages automatically. See `ax-event-runtime.md`.

## Examples

Fetch these for full working code:

- [Standard Schema (zod)](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/standard-schema.ts) — zod with f() and fn()
- [Chat](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/chat.ts) — multi-turn conversation
- [Marketing](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/marketing.ts) — product use case
- [MCP Integration](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-memory.ts) — MCP integration
