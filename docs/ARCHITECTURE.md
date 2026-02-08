# Ax Architecture

A technical guide to Ax's internal architecture for developers who want to understand how the framework works or contribute to its development.

## Overview

Ax is built on three main layers that work together to provide a type-safe, declarative framework for building AI programs:

1. **AI Provider Layer** - Abstracts different LLM providers
2. **DSP Layer** - Core signature parsing, validation, and program execution
3. **Orchestration Layer** - Complex workflow management with AxFlow

## Three-Layer Architecture

### 1. AI Provider Layer (`src/ax/ai/`)

The AI Provider Layer provides a unified interface for interacting with different LLM providers. All providers implement the `AxAIService` interface, which standardizes:

- Chat completions (streaming and non-streaming)
- Embeddings generation
- Function calling
- Token usage tracking
- Error handling

**Key Components:**

- `AxBaseAI` - Base class that all providers extend
- `AxAIService` - Interface defining the contract for AI providers
- Provider-specific implementations (OpenAI, Anthropic, Google Gemini, etc.)

**Provider Abstraction Benefits:**

- Switch providers with a single line of code
- Consistent behavior across different LLMs
- Automatic capability detection
- Unified error handling

**Example Provider Structure:**

```typescript
export class AxAIOpenAI extends AxBaseAI<...> {
  constructor(args: AxAIOpenAIArgs) {
    super(aiImpl, {
      name: 'openai',
      apiURL: 'https://api.openai.com/v1',
      headers: () => this.buildHeaders(),
      modelInfo: axModelInfoOpenAI,
      defaults: { model: AxAIOpenAIModel.GPT4Turbo },
      supportFor: (model) => this.getFeatures(model)
    });
  }
}
```

### 2. DSP Layer (`src/ax/dsp/`)

The DSP (Declarative Self-improving Programs) Layer is the core of Ax. It handles:

- Signature parsing and validation
- Program execution with retry logic
- Assertion handling
- Few-shot learning
- Prompt generation
- Optimization strategies

**Key Components:**

#### Signature System (`src/ax/dsp/sig.ts`)

The signature system is the foundation of Ax's type safety:

```typescript
// String-based signature
const sig = AxSignature.create('question:string -> answer:string, confidence:number');

// Fluent API signature
const sig = f()
  .input('question', f.string('User question'))
  .output('answer', f.string('Generated answer'))
  .output('confidence', f.number('Confidence score'))
  .build();
```

**Supported Field Types:**
- `string`, `number`, `boolean` - Basic types
- `json` - Arbitrary JSON data
- `class` - Classification with predefined options
- `image`, `audio`, `file` - Media types (input only)
- `date`, `datetime` - Temporal types
- `code` - Code snippets with language hints

**Field Modifiers:**
- `.optional()` - Makes field optional
- `.array()` - Makes field an array
- `.internal()` - Hides field from prompts (output only)

#### Program Execution (`src/ax/dsp/generate.ts`)

The `AxGen` class handles program execution with:

- **Streaming Support** - Real-time output with validation
- **Retry Logic** - Automatic error correction with assertions
- **Function Calling** - ReAct pattern for tool use
- **Multi-step Execution** - Iterative refinement
- **Sample Selection** - Multiple outputs with result picking

**Execution Flow:**

```
User Input
    ↓
Signature Validation
    ↓
Prompt Generation (with examples/demos)
    ↓
AI Provider Call
    ↓
Response Processing & Validation
    ↓
Assertion Checking (with retries)
    ↓
Type-safe Output
```

**Key Features:**

- **Assertions** - Validate outputs and trigger retries
- **Streaming Assertions** - Fail-fast validation during streaming
- **Field Processors** - Transform outputs before returning
- **Function Calling** - Native or prompt-based modes
- **Error Correction** - Automatic retry with error context

### 3. Orchestration Layer (`src/ax/flow/`)

AxFlow provides DAG-based workflow orchestration with:

- Automatic parallelization
- Dependency analysis
- State management
- Type-safe chaining
- Conditional branching

**Key Components:**

- `AxFlow` - Main workflow class with fluent API
- `AxFlowExecutionPlanner` - Analyzes dependencies for parallel execution
- `AxFlowDependencyAnalyzer` - Identifies independent operations

**Workflow Patterns:**

```typescript
// Sequential execution
flow<{ topic: string }>()
  .node('summarizer', 'text:string -> summary:string')
  .node('critic', 'summary:string -> critique:string')
  .execute('summarizer', state => ({ text: state.topic }))
  .execute('critic', state => ({ summary: state.summarizerResult.summary }))

// Parallel execution
flow<{ queries: string[] }>()
  .parallel([
    sub => sub.execute('retrieve1', state => ({ query: state.queries[0] })),
    sub => sub.execute('retrieve2', state => ({ query: state.queries[1] })),
    sub => sub.execute('retrieve3', state => ({ query: state.queries[2] }))
  ]).merge('allDocs', (docs1, docs2, docs3) => [...docs1, ...docs2, ...docs3])

// Conditional branching
flow<{ complexity: number }>()
  .branch(state => state.complexity > 0.5)
  .when(true)
    .execute('complexProcessor', state => ({ input: state.text }))
  .when(false)
    .execute('simpleProcessor', state => ({ input: state.text }))
  .merge()
```

## Module Structure

```
src/ax/
├── ai/                 # AI provider implementations
│   ├── base.ts        # Base AI class with unified interface
│   ├── anthropic/     # Anthropic Claude provider
│   ├── openai/        # OpenAI GPT provider
│   ├── google-gemini/ # Google Gemini provider
│   └── ...            # Other providers
├── dsp/               # DSP core
│   ├── sig.ts         # Signature system
│   ├── generate.ts    # Program execution
│   ├── optimizer.ts   # Optimization framework
│   ├── optimizers/    # Optimization strategies
│   │   ├── bootstrapFewshot.ts
│   │   ├── miproV2.ts
│   │   ├── ace.ts
│   │   └── gepa.ts
│   ├── functions.ts   # Function calling support
│   ├── asserts.ts     # Assertion system
│   └── prompt.ts      # Prompt generation
├── flow/              # AxFlow workflow system
│   ├── flow.ts        # Main AxFlow class
│   ├── executionPlanner.ts
│   └── dependencyAnalyzer.ts
├── mem/               # Memory management
│   └── memory.ts      # Conversation memory
├── docs/              # RAG and document processing
│   └── manager.ts     # Document management
├── db/                # Vector database integrations
│   ├── memory.ts      # In-memory vector store
│   ├── pinecone.ts    # Pinecone integration
│   └── weaviate.ts    # Weaviate integration
└── trace/             # OpenTelemetry tracing
    └── trace.ts
```

## Design Decisions

### Why TypeScript?

TypeScript provides:
- **Type Safety** - Catch errors at compile time
- **Better DX** - IntelliSense and autocomplete
- **Runtime Validation** - Combine with runtime checks
- **Ecosystem** - Works everywhere (Node.js, browsers, edge)

### Signature-First Design

Inspired by DSPy, signatures are:
- **Declarative** - Describe what, not how
- **Type-safe** - Generate TypeScript types
- **Optimizable** - Can be improved automatically
- **Composable** - Combine in workflows

This approach separates concerns:
- Signature defines the interface
- Implementation handles execution
- Optimization improves performance

### Provider Abstraction Strategy

Ax uses a unified interface approach:

```typescript
interface AxAIService {
  chat(req: AxChatRequest, options?: AxAIServiceOptions): Promise<AxChatResponse | ReadableStream>;
  embed(req: AxEmbedRequest, options?: AxAIServiceOptions): Promise<AxEmbedResponse>;
  getFeatures(model?: string): AxAIFeatures;
}
```

**Benefits:**
- Consistent API across providers
- Easy to add new providers
- Automatic capability detection
- Provider-specific features exposed through config

### Streaming Architecture

Streaming is first-class in Ax:
- All providers support streaming
- Validation during streaming
- Assertions can fail fast
- Proper backpressure handling

**Implementation:**

```typescript
// Streaming with validation
const stream = await gen.streamingForward(ai, values);
for await (const delta of stream) {
  // Process incremental updates
  console.log(delta.delta);
}
```

### Optimization Philosophy

Multiple optimization strategies for different needs:

- **BootstrapFewShot** - Fast, good for most cases
- **MiPRO** - Best accuracy, requires more compute
- **ACE** - Adaptive, learns from production
- **GEPA** - Multi-objective (quality vs cost/speed)

Each optimizer implements the same interface:

```typescript
interface AxOptimizer {
  compile(
    program: AxProgramWithSignature,
    examples: AxExample[],
    metric: AxMetricFn
  ): Promise<AxOptimizedProgram>;
}
```

### Error Handling Strategy

Ax uses a layered error handling approach:

1. **Validation Errors** - Caught and retried with corrections
2. **Assertion Errors** - Trigger automatic retry with context
3. **Provider Errors** - Wrapped with consistent error types
4. **Network Errors** - Handled with timeouts and retries

## Extending Ax

### Adding a New AI Provider

1. Create provider directory: `src/ax/ai/your-provider/`
2. Implement `AxAIService` interface
3. Create API client in `api.ts`
4. Add types in `types.ts`
5. Export from `src/ax/ai/index.ts`

**Example Structure:**

```typescript
// src/ax/ai/your-provider/api.ts
export class AxAIYourProvider extends AxBaseAI<...> {
  constructor(args: AxAIYourProviderArgs) {
    super(
      {
        createChatReq: this.createChatReq.bind(this),
        createChatResp: this.createChatResp.bind(this),
        createChatStreamResp: this.createChatStreamResp.bind(this),
      },
      {
        name: 'your-provider',
        apiURL: 'https://api.yourprovider.com',
        headers: () => this.buildHeaders(),
        modelInfo: axModelInfoYourProvider,
        defaults: { model: 'default-model' },
        supportFor: {
          functions: true,
          streaming: true,
          media: { images: { supported: false } }
        }
      }
    );
  }

  private async createChatReq(req: AxChatRequest) {
    // Convert to provider-specific format
    return [apiConfig, providerRequest];
  }

  private createChatResp(resp: ProviderResponse): AxChatResponse {
    // Convert from provider-specific format
    return axResponse;
  }
}
```

### Creating Custom Optimizers

1. Extend base optimizer class
2. Implement `compile()` method
3. Define metric function
4. Handle training data

**Example:**

```typescript
export class MyOptimizer implements AxOptimizer {
  async compile(
    program: AxProgramWithSignature,
    examples: AxExample[],
    metric: AxMetricFn
  ): Promise<AxOptimizedProgram> {
    // Your optimization logic
    const optimizedExamples = await this.optimizeExamples(examples);
    
    return {
      program,
      examples: optimizedExamples,
      metrics: { score: 0.95 }
    };
  }
}
```

### Adding Custom Field Types

Field types are defined in `src/ax/dsp/sigtypes.ts`. To add a new type:

1. Add type to `AxFieldType` union
2. Add parser in `src/ax/dsp/parser.ts`
3. Add validation in `src/ax/dsp/validate.ts`
4. Update JSON schema generation

### Creating AxFlow Extensions

Extend `AxFlow` for custom workflow patterns:

```typescript
class CustomFlow<IN, OUT> extends AxFlow<IN, OUT> {
  // Add custom methods
  public customPattern(...args: any[]) {
    // Implementation
    return this;
  }
}
```

## Performance Considerations

### Caching Strategy

- **Prompt Caching** - Provider-level caching (Anthropic, OpenAI)
- **Response Caching** - Cache deterministic outputs
- **Embedding Caching** - Reuse embeddings for RAG

### Parallel Execution

AxFlow automatically parallelizes independent operations:

```typescript
// Automatic parallelization
const flow = flow<{ queries: string[] }>({ autoParallel: true })
  .node('retrieve', 'query:string -> docs:string[]')
  .derive('results', 'queries', async (query) => {
    // These execute in parallel automatically
    return await retrieve(query);
  });
```

### Memory Management

- **Conversation Pruning** - Limit history size
- **Vector DB Pagination** - Handle large result sets
- **Streaming** - Avoid large memory buffers

## Observability

### OpenTelemetry Integration

Ax automatically creates spans for:
- AI provider calls
- Program execution
- Workflow steps
- Function calls

**Custom Attributes:**
- Token usage (input/output)
- Model configuration
- Latency metrics
- Cost estimates

### Metrics Tracked

- **Token Usage** - Input, output, total, thoughts
- **Latency** - Per operation with percentiles
- **Cost** - Estimated based on model pricing
- **Retry Counts** - Error correction attempts
- **Assertion Failures** - Validation issues

## Security Considerations

### API Key Management

- Never log API keys
- Support environment variables
- Validate keys before use

### Input Validation

- Sanitize user inputs
- Validate against schemas
- Rate limiting support

### Output Validation

- Assertions for safety
- Content moderation hooks
- PII detection support

## Testing Strategy

### Unit Tests

- Located alongside source files (`.test.ts`)
- Use Vitest framework
- Mock AI providers for deterministic tests

### Integration Tests

- Test with real AI providers
- Use environment variables for API keys
- Located in `src/ax/ai/integration.test.ts`

### Example Tests

- All examples should be runnable
- Serve as integration tests
- Document real-world usage

## Contributing to Architecture

When proposing architectural changes:

1. Open an issue for discussion
2. Consider backward compatibility
3. Update this document
4. Add tests for new components
5. Update examples if needed

## Resources

- [DSPy Paper](https://arxiv.org/abs/2310.03714) - Inspiration for signature-based programming
- [OpenTelemetry Spec](https://opentelemetry.io/docs/) - Observability standards
- [TypeScript Handbook](https://www.typescriptlang.org/docs/) - Language reference

For questions about architecture, join our [Discord](https://discord.gg/DSHg3dU7dW) or open a GitHub discussion.