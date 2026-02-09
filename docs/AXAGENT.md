# AxAgent Guide

`AxAgent` is the agent framework in Ax. It wraps `AxGen` with support for child agents, tool use, smart model routing, and **RLM (Recursive Language Model)** mode for processing long contexts through a code interpreter.

Use `AxAgent` when you need:
- Multi-step reasoning with tools (ReAct pattern)
- Composing multiple agents into a hierarchy
- Smart model routing across child agents
- Processing long documents without context window limits (RLM mode)

For single-step generation without tools or agents, use [`AxGen`](./AXGEN.md) directly.

## Creating Agents

Use the `agent()` factory function with a string signature:

```typescript
import { agent, ai } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

const myAgent = agent('userQuestion:string -> responseText:string', {
  name: 'helpfulAgent',
  description: 'An agent that provides helpful responses to user questions',
});

const result = await myAgent.forward(llm, { userQuestion: 'What is TypeScript?' });
console.log(result.responseText);
```

The `agent()` function accepts both string signatures and `AxSignature` objects:

```typescript
import { agent, s } from '@ax-llm/ax';

const sig = s('userQuestion:string -> responseText:string');
const myAgent = agent(sig, {
  name: 'helpfulAgent',
  description: 'An agent that provides helpful responses to user questions',
});
```

## Agent Options

The `agent()` factory accepts a configuration object:

```typescript
const myAgent = agent('input:string -> output:string', {
  // Required
  name: 'myAgent',                    // Agent name (min 5 chars)
  description: 'Does something useful and interesting with inputs',  // Min 20 chars

  // Optional
  ai: llm,                            // Bind a specific AI service
  definition: 'You are a helpful assistant that... (detailed prompt)',  // Min 100 chars if provided
  functions: [searchTool, calcTool],   // Tool functions
  agents: [childAgent1, childAgent2],  // Child agents
  maxSteps: 25,                        // Max reasoning steps (default: 25)
  maxRetries: 3,                       // Retries on assertion failures
  temperature: 0.7,                    // Sampling temperature
  disableSmartModelRouting: false,     // Disable automatic model selection
  excludeFieldsFromPassthrough: [],    // Fields NOT passed to child agents
  debug: false,                        // Debug logging

  // RLM mode (see RLM section below)
  rlm: { ... },
});
```

### `name`

The agent's name, used as the function name when called as a child agent. Minimum 5 characters. Converted to camelCase automatically (e.g. `'Physics Researcher'` becomes `physicsResearcher`).

### `description`

A short description of what the agent does. Minimum 20 characters. This is shown to parent agents when they decide which child to call.

### `definition`

An optional detailed system prompt for the LLM. Minimum 100 characters if provided. If omitted, the `description` is used as the prompt.

### `functions`

An array of tool functions the agent can call. Each function has a name, description, JSON Schema parameters, and an implementation.

### `agents`

An array of child agents. When provided, the agent can delegate subtasks to these children. See [Child Agents](#child-agents).

## Running Agents

### `forward()`

Run the agent and get the final result:

```typescript
const result = await myAgent.forward(llm, { userQuestion: 'Hello' });
console.log(result.responseText);
```

If the agent was created with `ai` bound, the parent AI is used as fallback:

```typescript
const myAgent = agent('input:string -> output:string', {
  name: 'myAgent',
  description: 'An agent that processes inputs reliably',
  ai: llm,  // Bound AI service
});

// Can also pass a different AI to override
const result = await myAgent.forward(differentLlm, { input: 'test' });
```

### `streamingForward()`

Stream partial results as they arrive:

```typescript
const stream = myAgent.streamingForward(llm, { userQuestion: 'Write a story' });

for await (const chunk of stream) {
  if (chunk.delta.responseText) {
    process.stdout.write(chunk.delta.responseText);
  }
}
```

### Forward Options

Both `forward` and `streamingForward` accept an options object as the third argument:

```typescript
const result = await myAgent.forward(llm, values, {
  model: 'smart',             // Override model
  maxSteps: 10,               // Override max steps
  debug: true,                // Enable debug logging
  functions: [extraTool],     // Additional tools (merged with agent's tools)
  thinkingTokenBudget: 'medium',
});
```

## Child Agents

Agents can compose other agents as children. The parent agent sees each child as a callable function and decides when to invoke it.

```typescript
const researcher = agent(
  'question:string, physicsQuestion:string -> answer:string',
  {
    name: 'Physics Researcher',
    description: 'Researcher for physics questions can answer questions about advanced physics',
  }
);

const summarizer = agent(
  'answer:string -> shortSummary:string',
  {
    name: 'Science Summarizer',
    description: 'Summarizer can write short summaries of advanced science topics',
    definition: 'You are a science summarizer. You can write short summaries of advanced science topics. Use numbered bullet points to summarize the answer in order of importance.',
  }
);

const scientist = agent('question:string -> answer:string', {
  name: 'Scientist',
  description: 'An agent that can answer advanced science questions',
  agents: [researcher, summarizer],
});

const result = await scientist.forward(llm, {
  question: 'Why is gravity not a real force?',
});
```

### Value Passthrough

When a parent and child agent share input field names, the parent automatically passes those values to the child. For example, if the parent has `question:string` and a child also expects `question:string`, the parent's value is injected automatically — the LLM doesn't need to re-type it.

Control which fields are excluded from passthrough:

```typescript
const myAgent = agent('context:string, query:string -> answer:string', {
  name: 'myAgent',
  description: 'An agent that processes queries with context provided',
  agents: [childAgent],
  excludeFieldsFromPassthrough: ['context'],  // Don't pass context to children
});
```

### Smart Model Routing

When an AI service is configured with multiple models, agents automatically expose a `model` parameter to parent agents. The parent LLM can choose which model to use for each child call based on task complexity.

```typescript
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  models: [
    { key: 'dumb', model: 'gpt-3.5-turbo', description: 'Simple questions' },
    { key: 'smart', model: 'gpt-4o-mini', description: 'Advanced questions' },
    { key: 'smartest', model: 'gpt-4o', description: 'Most complex questions' },
  ],
});
```

Disable smart routing per-agent with `disableSmartModelRouting: true`.

## RLM Mode

**RLM (Recursive Language Model)** mode lets agents process arbitrarily long documents without hitting context window limits. Instead of stuffing the entire document into the LLM prompt, RLM loads it into a code interpreter session and gives the LLM tools to analyze it programmatically.

### The Problem

When you pass a long document to an LLM, you face:
- **Context window limits** — the document may not fit
- **Context rot** — accuracy degrades as context grows
- **Cost** — long prompts are expensive

### How It Works

1. **Context extraction** — Fields listed in `contextFields` are removed from the LLM prompt and loaded into a code interpreter session as variables.
2. **Code interpreter** — The LLM gets a `codeInterpreter` tool to execute code in a persistent REPL. Variables and state persist across calls.
3. **Sub-LM queries** — Inside the code interpreter, `llmQuery(query, context?)` calls a sub-LM for semantic analysis of chunks. `llmQueryBatched([...])` runs multiple queries in parallel.
4. **Final answer** — When done, the LLM provides its final answer with the required output fields.

The LLM writes code to chunk, filter, and iterate over the document, using `llmQuery` only for semantic understanding of small pieces. This keeps the LLM prompt small while allowing analysis of unlimited context.

### Configuration

```typescript
import { agent, ai } from '@ax-llm/ax';
import { AxRLMJSInterpreter } from '@ax-llm/ax-tools';

const analyzer = agent(
  'context:string, query:string -> answer:string, evidence:string[]',
  {
    name: 'documentAnalyzer',
    description: 'Analyzes long documents using code interpreter and sub-LM queries',
    maxSteps: 15,
    rlm: {
      contextFields: ['context'],              // Fields to load into interpreter
      interpreter: new AxRLMJSInterpreter(),   // Code interpreter implementation
      maxLlmCalls: 30,                         // Cap on sub-LM calls (default: 50)
      subModel: 'gpt-4o-mini',                // Model for llmQuery (default: same as parent)
    },
  }
);
```

### The REPL Loop

In RLM mode, the agent gets a special function:

- **`codeInterpreter`** — Execute code in a persistent session. Context fields are available as global variables.

The LLM's typical workflow:

```
1. Peek at context structure (typeof, length, slice)
2. Chunk the context into manageable pieces
3. Use llmQuery for semantic analysis of each chunk
4. Aggregate results
5. Provide the final answer with the required output fields
```

### Available APIs in the Sandbox

Inside the code interpreter, these functions are available as globals:

| API | Description |
|-----|-------------|
| `await llmQuery(query, context?)` | Ask a sub-LM a question, optionally with a context string |
| `await llmQueryBatched([{ query, context? }, ...])` | Run multiple sub-LM queries in parallel |
| `print(...args)` | Print output (appears in the function result) |
| Context variables | All fields listed in `contextFields` are available by name |

### Custom Interpreters

The built-in `AxRLMJSInterpreter` uses Node.js `vm` module. For other environments, implement the `AxCodeInterpreter` interface:

```typescript
import type { AxCodeInterpreter, AxCodeSession } from '@ax-llm/ax';

class MyBrowserInterpreter implements AxCodeInterpreter {
  readonly language = 'JavaScript';

  createSession(globals?: Record<string, unknown>): AxCodeSession {
    // Set up your execution environment with globals
    return {
      async execute(code: string): Promise<unknown> {
        // Execute code and return result
      },
      close() {
        // Clean up resources
      },
    };
  }
}
```

The `globals` object passed to `createSession` includes:
- All context field values (by field name)
- `llmQuery` function
- `llmQueryBatched` function
- `print` function

### RLM with Streaming

RLM mode does not support true streaming. When using `streamingForward`, RLM runs the full analysis and yields the final result as a single chunk.

## API Reference

### `AxRLMConfig`

```typescript
interface AxRLMConfig {
  contextFields: string[];        // Input fields holding long context
  interpreter: AxCodeInterpreter; // Code interpreter implementation
  maxLlmCalls?: number;           // Cap on sub-LM calls (default: 50)
  subModel?: string;              // Model for llmQuery sub-calls
}
```

### `AxCodeInterpreter`

```typescript
interface AxCodeInterpreter {
  readonly language: string;  // e.g. 'JavaScript', 'Python'
  createSession(globals?: Record<string, unknown>): AxCodeSession;
}
```

### `AxCodeSession`

```typescript
interface AxCodeSession {
  execute(code: string): Promise<unknown>;
  close(): void;
}
```

### `AxAgentConfig`

```typescript
interface AxAgentConfig<IN, OUT> extends AxAgentOptions {
  ai?: AxAIService;
  name: string;
  description: string;
  definition?: string;
  agents?: AxAgentic<IN, OUT>[];
  functions?: AxInputFunctionType;
}
```

### `AxAgentOptions`

Extends `AxProgramForwardOptions` (without `functions`) with:

```typescript
{
  disableSmartModelRouting?: boolean;
  excludeFieldsFromPassthrough?: string[];
  debug?: boolean;
  rlm?: AxRLMConfig;
}
```
