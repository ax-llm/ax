---
title: "API Reference"
description: "Complete API documentation for Ax"
---

# API Reference

Complete API documentation for Ax - the DSPy framework for TypeScript.

## Core Functions

### `ai(options)` - Create AI Instance

Factory function to create an AI provider instance.

```typescript
const llm = ai({
  name: "openai" | "anthropic" | "google-gemini" | "mistral" | "groq" | "cohere" | "together" | "deepseek" | "ollama" | "huggingface" | "openrouter" | "azure-openai" | "reka" | "x-grok",
  apiKey?: string,
  config?: {
    model?: string,
    baseURL?: string,
    headers?: Record<string, string>,
    thinking?: { includeThoughts: boolean }
  },
  options?: {
    debug?: boolean,
    logger?: AxLoggerFunction,
    tracer?: Tracer,
    rateLimiter?: RateLimiter,
    fetch?: typeof fetch,
    corsProxy?: string  // For browser usage
  }
});
```

### `ax(signature, options?)` - Create Generator

Factory function to create a DSPy generator from a signature.

```typescript
const generator = ax(
  signature: string,  // "input:type -> output:type"
  options?: {
    description?: string,
    examples?: Array<Example>,
    functions?: Array<AxFunction>,
    asserts?: Array<AssertFunction>,
    streamingAsserts?: Map<string, StreamingAssertFunction>,
    maxCompletionTokens?: number,
    maxRetries?: number,
    maxSteps?: number,
    promptTemplate?: string,
    logger?: AxLoggerFunction,
    tracer?: Tracer,
    meter?: Meter
  }
);
```

### `agent(options)` - Create Agent

Factory function to create an AI agent.

```typescript
const myAgent = agent({
  name: string,
  description: string,
  signature: string | AxSignature | AxGen,
  definition?: string,
  functions?: Array<AxFunction>,
  agents?: Array<AxAgent>,
  ai?: AxAI,
  options?: {
    debug?: boolean,
    logger?: AxLoggerFunction,
    tracer?: Tracer
  }
});
```

### `s(signature)` - Create Signature

Helper function to create type-safe signatures.

```typescript
const signature = s('input:string -> output:string');
```

### `f` - Field Helpers

Field creation utilities for building complex signatures.

```typescript
// Basic types
f.string(description?: string)
f.number(description?: string)
f.boolean(description?: string)
f.json(description?: string)
f.date(description?: string)
f.datetime(description?: string)
f.code(description?: string)
f.url(description?: string)
f.file(description?: string)

// Media types
f.image(description?: string)
f.audio(description?: string)

// Modifiers
f.array(field: AxField)           // Creates array type
f.optional(field: AxField)        // Makes field optional
f.class(options: string[], description?: string)  // Enumeration

// Builder
f()  // Returns fluent builder for complex signatures
  .input(name: string, field: AxField)
  .output(name: string, field: AxField)
  .build()
```

## Generator Methods

### `forward(ai, input, options?)`

Execute the generator and get results.

```typescript
const result = await generator.forward(
  ai: AxAI,
  input: InputType,
  options?: {
    model?: string,
    maxTokens?: number,
    temperature?: number,
    stream?: boolean,
    thinkingTokenBudget?: "minimal" | "low" | "medium" | "high",
    examples?: Array<Example>,
    maxRetries?: number,
    maxSteps?: number,
    logger?: AxLoggerFunction,
    tracer?: Tracer,
    span?: Span
  }
): Promise<OutputType>
```

### `streamingForward(ai, input, options?)`

Stream results as they generate.

```typescript
const stream = await generator.streamingForward(
  ai: AxAI,
  input: InputType,
  options?: ForwardOptions
): AsyncGenerator<Partial<OutputType>>

for await (const chunk of stream) {
  console.log(chunk);
}
```

### `addAssert(fn, message)`

Add validation that runs after generation.

```typescript
generator.addAssert(
  (output: OutputType) => boolean,
  errorMessage: string
);
```

### `addStreamingAssert(fieldName, fn, message)`

Add validation that runs during streaming.

```typescript
generator.addStreamingAssert(
  fieldName: string,
  (value: any) => boolean,
  errorMessage: string
);
```

### `addFieldProcessor(fieldName, processor)`

Add field transformation/validation.

```typescript
generator.addFieldProcessor(
  fieldName: string,
  processor: (value: any, state: any) => any
);
```

### `applyOptimization(program)`

Apply optimized configuration from training.

```typescript
generator.applyOptimization(optimizedProgram: AxOptimizedProgram);
```

## Agent Methods

### `forward(ai, input, options?)`

Execute agent with input.

```typescript
const result = await agent.forward(
  ai: AxAI,
  input: InputType,
  options?: ForwardOptions
): Promise<OutputType>
```

### `setFunctions(functions)`

Set available functions for the agent.

```typescript
agent.setFunctions(functions: Array<AxFunction>);
```

### `setAgents(agents)`

Set sub-agents the agent can use.

```typescript
agent.setAgents(agents: Array<AxAgent>);
```

## AI Service Methods

### `chat(options)`

Direct chat with the LLM.

```typescript
const response = await llm.chat({
  chatPrompt: Array<{ role: "system" | "user" | "assistant", content: string }>,
  model?: string,
  maxTokens?: number,
  temperature?: number,
  topP?: number,
  stream?: boolean,
  streamingHandler?: (chunk: string) => void,
  functions?: Array<AxFunction>,
  functionCall?: "none" | "auto" | { name: string }
});
```

### `embed(options)`

Generate embeddings for text.

```typescript
const { embeddings } = await llm.embed({
  texts: string[],
  model?: string
});
```

### `getModelList()`

Get available models.

```typescript
const models = llm.getModelList();
// Returns: Array<{ key: string, model: string, description?: string }>
```

## AxFlow - Workflow Orchestration

### Creating Workflows

```typescript
const workflow = new AxFlow<InputState, OutputState>()
  .node(name: string, signature: string | AxGen)
  .execute(nodeName: string, mapper: (state) => NodeInput)
  .decision(condition: (state) => boolean)
    .yes((flow) => flow.execute(...))
    .no((flow) => flow.execute(...))
  .loop(condition: (state) => boolean, (flow) => flow.execute(...))
  .returns(mapper: (state) => OutputState);
```

### Workflow Execution

```typescript
const result = await workflow.forward(
  ai: AxAI,
  input: InputState,
  options?: WorkflowOptions
);
```

## Vector Database

### AxDB - Vector Database Interface

```typescript
const db = new AxDB({
  name: "memory" | "weaviate" | "pinecone" | "cloudflare",
  apiKey?: string,
  host?: string,
  namespace?: string
});

// Insert vectors
await db.upsert({
  id: string,
  table: string,
  values: number[],
  metadata?: Record<string, any>
});

// Query similar vectors
const matches = await db.query({
  table: string,
  values: number[],
  topK?: number,
  where?: Record<string, any>
});
```

### AxDBManager - Smart Document Management

```typescript
const manager = new AxDBManager({
  ai: AxAI,
  db: AxDB,
  chunkSize?: number,
  chunkOverlap?: number,
  reranker?: AxReranker,
  queryRewriter?: AxQueryRewriter
});

// Insert and chunk text
await manager.insert(text: string, metadata?: Record<string, any>);

// Query with reranking
const results = await manager.query(
  query: string,
  options?: { topK?: number }
);
```

## RAG - Retrieval Augmented Generation

### axRAG - Advanced RAG Pipeline

```typescript
const rag = axRAG(
  queryFunction: (query: string) => Promise<Array<Result>>,
  options?: {
    maxHops?: number,
    maxIterations?: number,
    qualityThreshold?: number,
    qualityTarget?: number,
    debug?: boolean
  }
);

const result = await rag.forward(ai: AxAI, {
  originalQuestion: string
});
```

## Optimization

### AxMiPRO - MiPRO v2 Optimizer

```typescript
const optimizer = new AxMiPRO({
  studentAI: AxAI,
  teacherAI?: AxAI,
  examples: Array<Example>,
  options?: {
    maxBootstrapAttempts?: number,
    maxLabeledCandidates?: number,
    maxErrors?: number,
    maxRoundsPerDepth?: number,
    minDatapointsPerDepth?: number[],
    requiredDatapointsPerDepth?: number[],
    endWhenOptimal?: boolean,
    checkpointCallback?: (state: CheckpointState) => void
  }
});

const result = await optimizer.compile(
  program: AxGen,
  examples: Array<Example>,
  metric: (prediction: any, example: any) => number
);
```

### AxBootstrapFewShot - Bootstrap Optimizer

```typescript
const optimizer = new AxBootstrapFewShot({
  ai: AxAI,
  examples: Array<Example>,
  options?: {
    maxBootstrappedDemos?: number,
    maxLabeledDemos?: number,
    maxRounds?: number,
    maxErrors?: number
  }
});

const result = await optimizer.compile(
  program: AxGen,
  examples: Array<Example>,
  metric: MetricFunction
);
```

## MCP - Model Context Protocol

### AxMCPClient

```typescript
const client = new AxMCPClient(
  transport: AxMCPTransport,
  options?: { debug?: boolean }
);

await client.init();

// Use with agents or generators
const agent = agent({
  functions: [client]
});
```

### Transports

```typescript
// Stdio transport (local servers)
const transport = new AxMCPStdioTransport({
  command: string,
  args?: string[],
  env?: Record<string, string>
});

// HTTP transport (remote servers)
const transport = new AxMCPStreambleHTTPTransport(
  url: string,
  headers?: Record<string, string>
);
```

## Utilities

### Multi-Service Router

```typescript
const router = AxMultiServiceRouter.create([service1, service2]);

// Routes to appropriate service based on model
await router.chat({ model: "gpt-4", ... });
```

### Load Balancer

```typescript
const balancer = AxBalancer.create([service1, service2]);

// Automatically balances load and handles failures
await balancer.chat({ ... });
```

### Document Processing

```typescript
// Apache Tika integration
const tika = new AxApacheTika(url?: string);
const text = await tika.convert(filePath: string);
```

### Telemetry

```typescript
import { axGlobals } from "@ax-llm/ax";

// Set global tracer
axGlobals.tracer = trace.getTracer("my-app");

// Set global meter
axGlobals.meter = metrics.getMeter("my-app");
```

## Type Definitions

### Field Types

- `string` - Text field
- `number` - Numeric field
- `boolean` - Boolean field
- `json` - JSON object field
- `date` - Date field (YYYY-MM-DD)
- `datetime` - DateTime field (ISO 8601)
- `image` - Image input ({ mimeType, data })
- `audio` - Audio input ({ format, data })
- `file` - File input
- `url` - URL field
- `code` - Code field
- `class` - Enumeration (one of specified values)

### Field Modifiers

- `[]` - Array (e.g., `string[]`)
- `?` - Optional (e.g., `field?:string`)
- `!` - Internal/reasoning field (not in output)

### Signature Format

```
"fieldName:type \"description\", ... -> outputField:type \"description\", ..."
```

Examples:
```typescript
// Simple
"question:string -> answer:string"

// With descriptions
"text:string \"Input text\" -> summary:string \"Brief summary\""

// Multiple fields
"name:string, age:number -> greeting:string"

// Complex types
"items:string[] -> selected:class \"a,b,c\", count:number"

// Optional and internal
"required:string, optional?:string, reasoning!:string -> result:string"
```

## Error Handling

All methods can throw:
- `AxError` - Base error class
- `AxValidationError` - Signature/field validation errors
- `AxGenerationError` - Generation failures
- `AxTimeoutError` - Operation timeouts
- `AxRateLimitError` - Rate limit exceeded

```typescript
try {
  const result = await gen.forward(llm, input);
} catch (error) {
  if (error instanceof AxValidationError) {
    // Handle validation error
  } else if (error instanceof AxGenerationError) {
    // Handle generation error
  }
}
```

## Browser Usage

For browser environments, use a CORS proxy:

```typescript
const llm = ai({
  name: "openai",
  apiKey: "your-key",
  options: {
    corsProxy: "http://localhost:3001"
  }
});
```

## Environment Variables

Common environment variables:
- `OPENAI_APIKEY` - OpenAI API key
- `ANTHROPIC_APIKEY` - Anthropic API key
- `GOOGLE_APIKEY` - Google API key
- `MISTRAL_APIKEY` - Mistral API key
- `GROQ_APIKEY` - Groq API key
- `TOGETHER_APIKEY` - Together API key
- `DEEPSEEK_APIKEY` - DeepSeek API key
- `HUGGINGFACE_APIKEY` - Hugging Face API key

---

For more examples and patterns, see the [examples directory](src/examples/).