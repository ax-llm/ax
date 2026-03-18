---
name: ax
description: This skill helps with using the @ax-llm/ax TypeScript library for building LLM applications. Use when the user asks about ax(), ai(), f(), s(), agent(), flow(), AxGen, AxAgent, AxFlow, signatures, streaming, or mentions @ax-llm/ax.
version: "__VERSION__"
---

# Ax Library (@ax-llm/ax) Quick Reference

Ax is a TypeScript library for building LLM-powered applications with type-safe signatures, streaming support, and multi-provider compatibility.

> **Detailed skills available:** ax-ai (providers), ax-signature (signatures/types), ax-gen (generators), ax-agent (agents/runtime), ax-agent-optimize (agent tuning/eval), ax-flow (workflows), ax-gepa (Pareto optimization), ax-learn (self-improving agents).

## Imports & Factories

```typescript
// Prefer factory functions: ax(), ai(), agent(), flow() — not new AxGen(), new AxAI(), etc.
import { ax, ai, f, s, fn, agent, flow, AxMemory, AxMCPClient, AxLearn } from '@ax-llm/ax';

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

// Function tool
const tool = fn('search')
  .description('Search the web')
  .arg('query', f.string('Search query'))
  .returns(f.string('Search results'))
  .handler(({ query }) => searchWeb(query))
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
| Model override | `model` | `{ model: 'gpt-4o-mini' }` |
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
import { axCreateDefaultColorLogger } from '@ax-llm/ax';

const result = await gen.forward(llm, { input: 'test' }, {
  debug: true,
  logger: axCreateDefaultColorLogger(),
  // OpenTelemetry
  tracer: openTelemetryTracer,
  meter: openTelemetryMeter,
});
```

## MCP Integration

```typescript
import { AxMCPClient } from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

// Stdio transport (local MCP server)
const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
});

const mcpClient = new AxMCPClient(transport, { debug: false });
await mcpClient.init();

// Use with agent
const myAgent = agent('userMessage:string -> response:string', {
  name: 'assistant',
  description: 'An assistant with MCP tools',
  functions: [mcpClient],
});
```

### HTTP Transport (Remote MCP)

```typescript
import { AxMCPStreambleHTTPTransport } from '@ax-llm/ax/mcp/transports/httpStreamTransport.js';

const transport = new AxMCPStreambleHTTPTransport('https://remote.mcp.pipedream.net', {
  headers: { 'x-pd-project-id': projectId },
  authorization: `Bearer ${accessToken}`,
});
```

### MCP Capabilities

| Capability | Prefix | Description |
|---|---|---|
| Tools | *(none)* | Function calls |
| Prompts | `prompt_` | Prompt templates |
| Resources | `resource_` | File/data access |

```typescript
const caps = mcpClient.getCapabilities();
const functions = mcpClient.toFunction();
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
  addAssert(fn: (output: OUT) => boolean, message?: string): void;
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

## Examples

Fetch these for full working code:

- [Chat](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/chat.ts) — multi-turn conversation
- [Marketing](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/marketing.ts) — product use case
- [MCP Integration](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/mcp-client-memory.ts) — MCP integration
