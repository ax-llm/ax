# Ax, DSPy for Typescript

Working with LLMs is complex they don't always do what you want. DSPy makes it
easier to build amazing things with LLMs. Just define your inputs and outputs
(signature) and an efficient prompt is auto-generated and used. Connect together
various signatures to build complex systems and workflows using LLMs

And to help you really use this in production we have everything else you need
like observability, streaming, support for other modalities (images,audio, etc),
error-correction, multi-step function calling, MCP, RAG, etc

<img width="517" alt="Screenshot 2025-06-30 at 12 52 57 PM" src="https://github.com/user-attachments/assets/059865cd-dfc3-4db1-9e04-7e9fc55a1f90" />

[![NPM Package](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=green)](https://www.npmjs.com/package/@ax-llm/ax)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://img.shields.io/discord/1078454354849304667?style=for-the-badge&color=green)](https://discord.gg/DSHg3dU7dW)

<!-- header -->

## Why use Ax?

- Standard interface across all top LLMs
- Prompts compiled from simple signatures
- Full native end-to-end streaming
- Support for thinking budget and thought tokens
- Build Agents that can call other agents
- AxFlow workflow orchestration (Beta)
- Built-in MCP, Model Context Protocol support
- Convert docs of any format to text
- RAG, smart chunking, embedding, querying
- Integrates with Vercel AI SDK
- Output validation while streaming
- Multi-modal DSPy supported
- Automatic prompt tuning using optimizers
- OpenTelemetry tracing / observability
- Production-ready TypeScript code
- Lightweight, zero dependencies

## Production Ready

- No breaking changes (minor versions)
- Large test coverage
- Built-in OpenTelemetry `gen_ai` support
- Widely used by startups in prod

## Recent Updates

**v14.0.4** - MiPro Python integration, unified optimization results, improved
logging\
**v14.0.3** - Enhanced validation, signature tool calling, better type safety\
**v14.0.2** - Custom OpenAI URLs, media validation, stability improvements\
**v14.0.0** - axRAG, fluent API, file/URL types, enhanced AxFlow

[View Full Changelog](CHANGELOG.md) | [Migration Guide](MIGRATION.md)

## What's a prompt signature?

<img width="860" alt="shapes at 24-03-31 00 05 55" src="https://github.com/dosco/llm-client/assets/832235/0f0306ea-1812-4a0a-9ed5-76cd908cd26b">

Efficient type-safe prompts are auto-generated from a simple signature. A prompt
signature is made up of a
`"task description" inputField:type "field description" -> "outputField:type`.
The idea behind prompt signatures is based on work done in the
"Demonstrate-Search-Predict" paper.

You can have multiple input and output fields. See Field Types & Modifiers below
for supported types and syntax.

### Field Types and Modifiers

- Types: `string`, `number`, `boolean`, `date`, `datetime`, `json`, `image`,
  `audio`, `file`, `url`, `code`, `class "a,b,c"`
- Arrays: add `[]` (e.g., `tags:string[]`)
- Classifications: `category:class "option1, option2, option3"`
- Optional: add `?` (e.g., `field?:string`)
- Internal: add `!` for reasoning fields not in output (e.g.,
  `reasoning!:string`)

### Type-Safe Signatures

```typescript
import { ai, ax } from "@ax-llm/ax";

// Basic type-safe generator
const gen = ax("question:string -> answer:string");

// Advanced with types and descriptions
const sentimentGen = ax(
  'text:string "Text to analyze" -> sentiment:class "positive, negative, neutral", confidence:number "0-1 score"',
);

// TypeScript provides full type safety
const result = await sentimentGen.forward(llm, { text: "Great product!" });
console.log(result.sentiment); // "positive" | "negative" | "neutral"
```

### Fluent API for Complex Signatures

```typescript
import { f } from "@ax-llm/ax";

// Build complex signatures programmatically
const sig = f()
  .input("userMessage", f.string("User input").optional())
  .output("response", f.string("AI response"))
  .output("sentiment", f.class(["positive", "negative", "neutral"]))
  .build();

const gen = ax(sig);
```

## API Changes & Deprecations

**v14.0.0+** deprecates template literals and constructors. Use factory
functions: `ai()`, `ax()`, `agent()`. See [**MIGRATION.md**](MIGRATION.md) for
details.

## Field Types Reference

See Field Types and Modifiers above for a concise overview. Example:
`userInput:string "User question", priority:class "high,low" "Urgency level", tags?:string[] "Optional tags"`

## LLMs Supported

`Google Gemini`, `OpenAI`, `OpenAI Responses`, `Azure OpenAI`, `Anthropic`,
`X Grok`, `TogetherAI`, `Cohere`, `Mistral`, `Groq`, `DeepSeek`, `Ollama`,
`Reka`, `Hugging Face`

## Install

### Node.js / Bundlers

```bash
npm install @ax-llm/ax
# or
yarn add @ax-llm/ax
```

### Browser (CDN)

```html
<!-- Global variable (window.ax) -->
<script src="https://unpkg.com/@ax-llm/ax@latest?conditions=browser"></script>

<!-- Or ES modules -->
<script type="module">
  import { ai, ax, f } from "https://unpkg.com/@ax-llm/ax@latest";
</script>
```

**Browser CORS Setup:** Most LLM providers require a CORS proxy for browser
usage. See our [browser example](web-chat.html) which includes a simple CORS
proxy setup.

```javascript
const llm = ai({
  name: "openai",
  apiKey: "your-api-key",
  options: {
    corsProxy: "http://localhost:3001", // Your CORS proxy URL
  },
});
```

## Quickstart (2 minutes)

### Node (recommended)

```ts
import { ai, ax } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

const gen = ax("question:string -> answer:string");
const res = await gen.forward(llm, { question: "Hello!" });
console.log(res.answer);
```

- Install: `npm i @ax-llm/ax`
- Run: `OPENAI_APIKEY=... node --import=tsx your_file.ts`

### Pick a provider

```ts
// OpenAI
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

// Google Gemini
const gemini = ai({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY!,
});
```

### Try in the browser

- See Browser (CDN) above and the `web-chat.html` example (requires a CORS
  proxy).

### Gotchas (1 minute read)

- Use descriptive field names (no generic names like `text`, `input`, `output`).
- Always pass `llm` to `.forward` and `.streamingForward`.
- Browser requires `options.corsProxy` for most providers.
- Media: images `{ mimeType, data }`, audio `{ format, data }`.
- Template literals/constructors are deprecated — use `ai()`, `ax()`, `agent()`.

### Copy‑paste templates

```ts
// Summarize
const summarize = ax(
  'textToSummarize:string -> shortSummary:string "5-10 words"',
);
const out1 = await summarize.forward(llm, { textToSummarize: "Long text..." });
```

```ts
// Classify
const classify = ax(
  'reviewText:string -> sentiment:class "positive, negative, neutral", confidence:number "0-1"',
);
const out2 = await classify.forward(llm, { reviewText: "Great product!" });
```

```ts
// Function calling
const functions = [{
  name: "getCurrentWeather",
  description: "get weather for a location",
  parameters: {
    type: "object",
    properties: { location: { type: "string" } },
    required: ["location"],
  },
  func: async ({ location }: { location: string }) => `72°F in ${location}`,
}];

const answerer = ax("question:string -> answer:string", { functions });
const out3 = await answerer.forward(llm, { question: "Weather in SF?" });
```

### First three examples to try

- Summarize: `OPENAI_APIKEY=... npm run tsx ./src/examples/summarize.ts`
- Classify: `OPENAI_APIKEY=... npm run tsx ./src/examples/simple-classify.ts`
- Agent: `OPENAI_APIKEY=... npm run tsx ./src/examples/agent.ts`

### Next steps

- Agents: `src/examples/agent.ts`
- AxFlow: `AXFLOW.md`
- RAG quick win: `src/examples/rag-docs.ts`
- Telemetry/Metrics: `TELEMETRY.md`, `src/examples/metrics-export.ts`

## Quick Examples

### Text Summarization

```typescript
import { ai, ax } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY });

const summarizer = ax(
  'textToSummarize:string -> textType:class "note, email, reminder", shortSummary:string "5-10 words"',
);

const result = await summarizer.forward(llm, {
  textToSummarize: "Long text here...",
});
console.log(result.shortSummary);
```

### Customer Support Classification

```typescript
const classifier = ax(
  'userInput:string "Customer message" -> category:class "question, request, complaint", priority:class "high, medium, low", response:string "Suggested response", reasoning!:string "Internal analysis"',
);

const result = await classifier.forward(llm, {
  userInput: "My order hasn't arrived and I need it urgently!",
});

console.log(result.category, result.priority); // "complaint", "high"
// Note: reasoning! is internal and not in final output
```

### Agent Framework

```typescript
// Create specialized agents
const researcher = agent({
  name: "researcher",
  signature: ax('physicsQuestion:string -> answer:string "bullet points"'),
});

const summarizer = agent({
  name: "summarizer",
  signature: ax('text:string -> shortSummary:string "5-10 words"'),
});

// Main agent can use other agents
const mainAgent = agent({
  name: "researchAgent",
  signature: ax("question:string -> answer:string"),
  agents: [researcher, summarizer],
});

const result = await mainAgent.forward(llm, {
  question: "How many atoms are in the universe?",
});
```

## Thinking Models Support

```typescript
// Enable thinking capabilities
const llm = ai({
  name: "google-gemini",
  config: {
    model: "gemini-2.5-flash",
    thinking: { includeThoughts: true },
  },
});

// Control thinking budget per request
const result = await gen.forward(llm, {
  question: "Explain quantum entanglement",
}, { thinkingTokenBudget: "medium" } // 'minimal', 'low', 'medium', 'high'
);

console.log(result.thoughts); // Model's reasoning process
```

## Vector DBs Supported

Vector databases are critical to building LLM workflows. We have clean
abstractions over popular vector databases and our own quick in-memory vector
database.

| Provider   | Tested  |
| ---------- | ------- |
| In Memory  | 🟢 100% |
| Weaviate   | 🟢 100% |
| Cloudflare | 🟡 50%  |
| Pinecone   | 🟡 50%  |

```typescript
import { ai, AxDB } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY as string });

// Create embeddings from text using an LLM
const { embeddings } = await llm.embed({ texts: ["hello world"] });

// Create an in-memory vector db
const db = new AxDB({ name: "memory" });

// Insert into vector db
await db.upsert({
  id: "abc",
  table: "products",
  values: embeddings[0],
});

// Query for similar entries using embeddings
const matches = await db.query({
  table: "products",
  values: embeddings[0],
});
```

Alternatively you can use the `AxDBManager` which handles smart chunking,
embedding and querying everything for you, it makes things almost too easy.

```typescript
const manager = new AxDBManager({ ai: llm, db });
await manager.insert(text);

const matches = await manager.query(
  "John von Neumann on human intelligence and singularity.",
);
console.log(matches);
```

## RAG Documents

Using documents like PDF, DOCX, PPT, XLS, etc., with LLMs is a huge pain. We
make it easy with Apache Tika, an open-source document processing engine.

Launch Apache Tika

```shell
docker run -p 9998:9998 apache/tika
```

Convert documents to text and embed them for retrieval using the `AxDBManager`,
which also supports a reranker and query rewriter. Two default implementations,
`AxDefaultResultReranker` and `AxDefaultQueryRewriter`, are available.

```typescript
const tika = new AxApacheTika();
const text = await tika.convert("/path/to/document.pdf");

const manager = new AxDBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query("Find some text");
console.log(matches);
```

## Multi-modal DSPy

When using models like `GPT-4o` and `Gemini` that support multi-modal prompts,
we support using image fields, and this works with the whole DSP pipeline.

```typescript
const image = fs
  .readFileSync("./src/examples/assets/kitten.jpeg")
  .toString("base64");

const gen = ax(
  "question:string, animalImage:image -> answer:string",
);

const res = await gen.forward(llm, {
  question: "What family does this animal belong to?",
  animalImage: { mimeType: "image/jpeg", data: image },
});
```

When using models like `gpt-4o-audio-preview` that support multi-modal prompts
with audio support, we support using audio fields, and this works with the whole
DSP pipeline.

```typescript
const audio = fs
  .readFileSync("./src/examples/assets/comment.wav")
  .toString("base64");

const gen = ax("question:string, commentAudio:audio -> answer:string");

const res = await gen.forward(llm, {
  question: "What family does this animal belong to?",
  commentAudio: { format: "wav", data: audio },
});
```

## DSPy Chat API

Inspired by DSPy's demonstration weaving, Ax provides `AxMessage` for seamless
conversation history management. This allows you to build chatbots and
conversational agents that maintain context across multiple turns while
leveraging the full power of prompt signatures. See the example for more
details.

```shell
GOOGLE_APIKEY=api-key npm run tsx ./src/examples/chat.ts
```

```typescript
import { ai, ax, type AxMessage } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY as string });

// Create a chat assistant using string-based signatures
const chatBot = ax(
  'message:string "A casual message from the user" -> reply:string "A friendly, casual response"',
);

// Start a conversation with message history
const chat: AxMessage<{ message: string }>[] = [
  { role: "user", values: { message: "Hi! How are you doing today?" } },
];

// Get first response
let response = await chatBot.forward(llm, chat);
console.log(response.reply);

// Add response to chat history
chat.push({ role: "assistant", values: { message: response.reply as string } });

// Continue conversation with context
chat.push({
  role: "user",
  values: { message: "That's great! Can you tell me a fun fact?" },
});

response = await chatBot.forward(llm, chat);
console.log(response.reply);
```

The conversation history is automatically woven into the prompt, allowing the
model to maintain context and provide coherent responses. This works seamlessly
with all Ax features including streaming, function calling, and chain-of-thought
reasoning.

## Streaming

### Assertions

We support parsing output fields and function execution while streaming. This
allows for fail-fast and error correction without waiting for the whole output,
saving tokens and costs and reducing latency. Assertions are a powerful way to
ensure the output matches your requirements; they also work with streaming.

```typescript
import { ai, ax } from "@ax-llm/ax";

// AI service
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY as string });

// Setup the prompt program
const gen = ax("startNumber:number -> next10Numbers:number[]");

// Add an assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined;
}, "Numbers 5 is not allowed");

// Run the program with streaming enabled
const res = await gen.forward(llm, { startNumber: 1 }, { stream: true });

// Or run the program with end-to-end streaming
const generator = await gen.streamingForward(
  llm,
  { startNumber: 1 },
  { stream: true },
);
for await (const _ of generator) {}
```

The above example allows you to validate entire output fields as they are
streamed in. This validation works with streaming and when not streaming and is
triggered when the whole field value is available. For true validation while
streaming, check out the example below. This will massively improve performance
and save tokens at scale in production.

```typescript
// add a assertion to ensure all lines start with a number and a dot.
gen.addStreamingAssert(
  "answerInPoints",
  (value: string) => {
    const re = /^\d+\./;

    // split the value by lines, trim each line,
    // filter out empty lines and check if all lines match the regex
    return value
      .split("\n")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .every((x) => re.test(x));
  },
  "Lines must start with a number and a dot. Eg: 1. This is a line.",
);

// run the program with streaming enabled
const res = await gen.forward(
  llm,
  { question: "Provide a list of optimizations to speed up LLM inference." },
  { stream: true, debug: true },
);
```

### Field Processors

Field processors are a powerful way to process fields in a prompt. They are used
to process fields in a prompt before the prompt is sent to the LLM.

```typescript
const gen = ax("startNumber:number -> next10Numbers:number[]");

const streamValue = false;

const processorFunction = (value) => {
  return value.map((x) => x + 1);
};

// Add a field processor to the program
const processor = new AxFieldProcessor(
  gen,
  "next10Numbers",
  processorFunction,
  streamValue,
);

const res = await gen.forward({ startNumber: 1 });
```

## Model Context Protocol (MCP)

Ax provides seamless integration with the Model Context Protocol (MCP), allowing
your agents to access external tools, and resources through a standardized
interface.

### Using AxMCPClient

The `AxMCPClient` allows you to connect to any MCP-compatible server and use its
capabilities within your Ax agents:

```typescript
import { AxMCPClient, AxMCPStdioTransport } from "@ax-llm/ax-tools";

// Initialize an MCP client with a transport
const transport = new AxMCPStdioTransport({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-memory"],
});

// Create the client with optional debug mode
const client = new AxMCPClient(transport, { debug: true });

// Initialize the connection
await client.init();

// Use the client's functions in an agent
const memoryAgent = agent({
  name: "MemoryAssistant",
  description: "An assistant with persistent memory",
  signature: "input, userId -> response",
  functions: [client], // Pass the client as a function provider
});

// Or use the client with AxGen
const memoryGen = ax("input:string, userId:string -> response:string", {
  functions: [client],
});
```

### Using AxMCPClient with a Remote Server

Calling a remote MCP server with Ax is straightforward. For example, here's how
you can use the DeepWiki MCP server to ask questions about nearly any public
GitHub repository. The DeepWiki MCP server is available at
`https://mcp.deepwiki.com/mcp`.

```typescript
import {
  AxAgent,
  AxAI,
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPStreambleHTTPTransport,
} from "@ax-llm/ax";

// 1. Initialize the MCP transport to the DeepWiki server
const transport = new AxMCPStreambleHTTPTransport(
  "https://mcp.deepwiki.com/mcp",
);

// 2. Create the MCP client
const mcpClient = new AxMCPClient(transport, { debug: false });
await mcpClient.init(); // Initialize the connection

// 3. Initialize your AI model (e.g., OpenAI)
// Ensure your OPENAI_APIKEY environment variable is set
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY as string,
});

// 4. Create an AxAgent that uses the MCP client
const deepwikiAgent = agent<
  {
    // Define input types for clarity, matching a potential DeepWiki function
    questionAboutRepo: string;
    githubRepositoryUrl: string;
  },
  {
    answer: string;
  }
>({
  name: "DeepWikiQueryAgent",
  description: "Agent to query public GitHub repositories via DeepWiki MCP.",
  signature: "questionAboutRepo, githubRepositoryUrl -> answer",
  functions: [mcpClient], // Provide the MCP client to the agent
});

// 5. Formulate a question and call the agent
const result = await deepwikiAgent.forward(llm, {
  questionAboutRepo: "What is the main purpose of this library?",
  githubRepositoryUrl: "https://github.com/dosco/ax", // Example: Ax library itself
});
console.log("DeepWiki Answer:", result.answer);
```

This example shows how to connect to a public MCP server and use it within an Ax
agent. The agent's signature
(`questionAboutRepo, githubRepositoryUrl -> answer`) is an assumption of how one
might interact with the DeepWiki service; you would typically discover the
available functions and their signatures from the MCP server itself (e.g., via
an `mcp.getFunctions` call if supported, or documentation).

For a more complex example involving authentication and custom headers with a
remote MCP server, please refer to the `src/examples/mcp-client-pipedream.ts`
file in this repository.

## Type-Safe AI Models with Automatic Inference

**New in Ax**: Enhanced type safety with automatic model key inference! Define
your models once and get precise TypeScript types throughout your application.

### Enhanced Type Inference with Static Factory Methods

Use the static `.create()` method for automatic type inference from your models
array:

```typescript
import { AxAI, AxAIGoogleGeminiModel, AxAIOpenAIModel } from "@ax-llm/ax";

// ✨ Automatic type inference on models 'fast' | 'smart' | 'reasoning'
const openai = AxAI.create({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  models: [
    {
      key: "fast" as const,
      model: AxAIOpenAIModel.GPT4OMini,
      description: "Fast model for simple tasks",
    },
    {
      key: "smart" as const,
      model: AxAIOpenAIModel.GPT4O,
      description: "Smart model for complex tasks",
    },
    {
      key: "reasoning" as const,
      model: AxAIOpenAIModel.O1Preview,
      description: "Reasoning model for deep analysis",
    },
  ],
});

// Perfect IntelliSense! The models list has exact literal types
const models = openai.getModelList();
// models[0].key is typed as 'fast' | 'smart' | 'reasoning', not just string

// Type-safe model selection in chat requests
const response = await openai.chat({
  chatPrompt: [{ role: "user", content: "Hello!" }],
  model: "fast", // ✅ TypeScript validates this is a valid key
  // model: 'invalid' // ❌ TypeScript error - not in defined models
});
```

### Multi-Provider Type Safety

Combine multiple AI providers with precise type inference:

```typescript
// Each provider gets its own inferred model keys
const gemini = AxAI.create({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY!,
  models: [
    {
      key: "quick" as const,
      model: AxAIGoogleGeminiModel.Gemini15Flash,
      description: "Quick responses",
    },
    {
      key: "advanced" as const,
      model: AxAIGoogleGeminiModel.Gemini15Pro,
      description: "Advanced reasoning",
    },
  ],
});

// MultiServiceRouter automatically infers union of all model keys
const router = new AxMultiServiceRouter([openai, gemini]);
// router now knows about 'fast' | 'smart' | 'reasoning' | 'quick' | 'advanced'

const gen = ax("inputText:string -> outputText:string");
gen.forward(router, { inputText }, { model: "quick" });
// ax now knows about 'fast' | 'smart' | 'reasoning' | 'quick' | 'advanced'
```

## AxFlow: Build AI Workflows

**AxFlow** makes it easy to build complex AI workflows with automatic parallel
execution and simple, readable code.

### Quick Example

```typescript
import { ai, AxFlow } from "@ax-llm/ax";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY });

// Simple document analysis workflow
const documentAnalyzer = new AxFlow<
  { documentText: string },
  { summary: string; sentiment: string; keywords: string[] }
>()
  .node("summarizer", "documentText:string -> summary:string")
  .node("sentimentAnalyzer", "documentText:string -> sentiment:string")
  .node("keywordExtractor", "documentText:string -> keywords:string[]")
  // These three operations run automatically in parallel!
  .execute("summarizer", (state) => ({ documentText: state.documentText }))
  .execute(
    "sentimentAnalyzer",
    (state) => ({ documentText: state.documentText }),
  )
  .execute(
    "keywordExtractor",
    (state) => ({ documentText: state.documentText }),
  )
  .returns((state) => ({
    summary: state.summarizerResult.summary,
    sentiment: state.sentimentAnalyzerResult.sentiment,
    keywords: state.keywordExtractorResult.keywords,
  }));

const result = await documentAnalyzer.forward(llm, {
  documentText: "AI technology is revolutionary...",
});
```

> _"AxFlow doesn't just execute AI workflows—it orchestrates the future of
> intelligent systems with automatic performance optimization"_

For comprehensive documentation including multi-model orchestration, control
flow patterns, and production-ready resilience features, see our detailed
[**AxFlow Guide**](AXFLOW.md).

## Advanced RAG: `axRAG`

**`axRAG`** is a powerful, production-ready RAG (Retrieval-Augmented Generation)
implementation built on AxFlow that provides advanced multi-hop retrieval,
self-healing quality loops, and intelligent query refinement.

```typescript
import { axRAG } from "@ax-llm/ax";

// Create an advanced RAG pipeline with multi-hop retrieval and self-healing
const rag = axRAG(queryVectorDB, {
  maxHops: 3, // Multi-hop context accumulation
  qualityThreshold: 0.8, // Quality-driven retrieval
  maxIterations: 2, // Parallel sub-query processing
  qualityTarget: 0.85, // Self-healing quality loops
  debug: true, // Full pipeline visualization
});

const result = await rag.forward(llm, {
  originalQuestion:
    "How do ML algorithms impact privacy in financial services?",
});
```

**Key Features:** Multi-hop retrieval, intelligent query refinement, parallel
sub-query processing, self-healing quality loops, gap analysis, configurable
performance vs. quality trade-offs.

For comprehensive documentation, architecture details, and advanced examples,
see our detailed
[**AxRAG Guide**](https://github.com/ax-llm/ax/blob/main/AXRAG.md).

## AI Routing and Load Balancing

Ax provides two powerful ways to work with multiple AI services: a load balancer
for high availability and a router for model-specific routing.

### Load Balancer

The load balancer automatically distributes requests across multiple AI services
based on performance and availability. If one service fails, it automatically
fails over to the next available service.

```typescript
import {
  AxAI,
  AxAIAnthropicModel,
  AxAIOpenAIModel,
  AxBalancer,
} from "@ax-llm/ax";

// Setup multiple AI services with specific model configurations
const openaiService = AxAI.create({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
  models: [
    {
      key: "smart-model",
      model: AxAIOpenAIModel.GPT4O,
      description: "Smart Model via OpenAI",
    },
    {
      key: "fast-model",
      model: AxAIOpenAIModel.GPT4OMini,
      description: "Fast Model via OpenAI",
    },
  ] as const,
});

const anthropicService = AxAI.create({
  name: "anthropic",
  apiKey: process.env.ANTHROPIC_APIKEY,
  models: [
    {
      key: "smart-model",
      model: AxAIAnthropicModel.Claude35Sonnet,
      description: "Smart Model via Anthropic",
    },
    {
      key: "fast-model",
      model: AxAIAnthropicModel.Claude35Haiku,
      description: "Fast Model via Anthropic",
    },
  ] as const,
});

// Create type-safe load balancer with automatic model key inference
// TModelKey is automatically inferred as: "smart-model" | "fast-model"
const balancer = AxBalancer.create([openaiService, anthropicService]);

// Use like a regular AI service - automatically uses the best available service
// Model key is type-safe: only "smart-model" or "fast-model" are allowed
const response = await balancer.chat({
  chatPrompt: [{ role: "user", content: "Hello!" }],
  model: "smart-model", // ✅ Type-safe
});

// Or use the balance with AxGen
const gen = ax("question:string -> answer:string");
const res = await gen.forward(balancer, { question: "Hello!" });
```

### Multi-Service Router

The router lets you use multiple AI services through a single interface,
automatically routing requests to the right service based on the model
specified. With type-safe model key inference, you get automatic IntelliSense
and compile-time validation.

```typescript
import {
  AxAI,
  AxAIAnthropicModel,
  AxAIGoogleGeminiModel,
  AxAIOpenAIModel,
  AxMultiServiceRouter,
} from "@ax-llm/ax";

// Setup OpenAI with model list
const openaiService = AxAI.create({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
  models: [
    {
      key: "basic",
      model: AxAIOpenAIModel.GPT4OMini,
      description: "Model for simple tasks and quick questions",
    },
    {
      key: "medium",
      model: AxAIOpenAIModel.GPT4O,
      description: "Model for complex tasks like summarizing and coding",
    },
  ] as const,
});

// Setup Anthropic with model list
const anthropicService = AxAI.create({
  name: "anthropic",
  apiKey: process.env.ANTHROPIC_APIKEY,
  models: [
    {
      key: "deep-thinker",
      model: AxAIAnthropicModel.Claude35Sonnet,
      description: "Model for tasks requiring deep planning and analysis",
    },
  ] as const,
});

// Setup Google Gemini with model list
const googleService = AxAI.create({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY,
  models: [
    {
      key: "expert",
      model: AxAIGoogleGeminiModel.Gemini15Pro,
      description: "Model for very complex tasks and large essays",
    },
  ] as const,
});

// Create type-safe multi-service router with automatic model key inference
// TModelKey is automatically inferred as: "basic" | "medium" | "deep-thinker" | "expert"
const router = AxMultiServiceRouter.create([
  openaiService,
  anthropicService,
  googleService,
]);

// Route to specific models with full type safety
const basicResponse = await router.chat({
  chatPrompt: [{ role: "user", content: "Quick question!" }],
  model: "basic", // ✅ Routes to OpenAI GPT-4o Mini
});

const expertResponse = await router.chat({
  chatPrompt: [{ role: "user", content: "Complex analysis needed" }],
  model: "expert", // ✅ Routes to Google Gemini 1.5 Pro
});

// TypeScript will catch invalid model keys at compile time:
// model: "invalid-model" // ❌ Type error - not in union type

// Or use the router with AxGen
const gen = ax("question:string -> answer:string");
const res = await gen.forward(router, { question: "Hello!" });
```

**🚀 Type Safety Benefits:**

- **Automatic Type Inference**: Model keys are automatically inferred from
  service configurations
- **IntelliSense Support**: Get autocomplete for valid model keys in your IDE
- **Compile-time Validation**: TypeScript catches invalid model keys before
  runtime
- **Zero Breaking Changes**: Existing code continues to work, new factory
  methods provide enhanced types

**⚡ Use Cases:**

- **Load Balancer**: Ideal for high availability and automatic failover
- **Multi-Service Router**: Perfect for routing specific models to specific
  tasks
- **Combined Usage**: Use balancers with routers for complex architectures

Both classes work seamlessly with all Ax features like streaming, function
calling, and chain-of-thought prompting.

## OpenTelemetry support

The ability to trace and observe your llm workflow is critical to building
production workflows. OpenTelemetry is an industry-standard, and we support the
new `gen_ai` attribute namespace. Checkout `src/examples/telemetry.ts` for more
information.

```typescript
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
trace.setGlobalTracerProvider(provider);

const tracer = trace.getTracer("test");

const llm = ai({
  name: "ollama",
  config: { model: "nous-hermes2" },
  options: { tracer },
});

const gen = ax(
  'text:string -> shortSummary:string "summarize in 5 to 10 words"',
);

const res = await gen.forward({ text });
```

```json
{
  "traceId": "ddc7405e9848c8c884e53b823e120845",
  "name": "Chat Request",
  "id": "d376daad21da7a3c",
  "kind": "SERVER",
  "timestamp": 1716622997025000,
  "duration": 14190456.542,
  "attributes": {
    "gen_ai.system": "Ollama",
    "gen_ai.request.model": "nous-hermes2",
    "gen_ai.request.max_tokens": 500,
    "gen_ai.request.temperature": 0.1,
    "gen_ai.request.top_p": 0.9,
    "gen_ai.request.frequency_penalty": 0.5,
    "gen_ai.request.llm_is_streaming": false,
    "http.request.method": "POST",
    "url.full": "http://localhost:11434/v1/chat/completions",
    "gen_ai.usage.completion_tokens": 160,
    "gen_ai.usage.prompt_tokens": 290
  }
}
```

### Setting Telemetry Globally

You can set up OpenTelemetry tracing globally for all Ax operations using
`axGlobals`. You can also pass it into AxGen, AxAI, AxAgent, etc as needed.

```typescript
// Set the tracer globally for all Ax operations
axGlobals.tracer = trace.getTracer("my-app");
// Set the meter globally
axGlobals.meter = metrics.getMeter("my-app");
```

## DSPy Metrics & Observability

Ax provides comprehensive metrics tracking for DSPy-style generation workflows,
giving you deep insights into performance, error rates, and optimization
opportunities. The metrics system tracks everything from basic generation
latency to complex multi-step function calling patterns.

### Automatic Metrics Collection

When you set up a meter globally, AxGen automatically tracks detailed metrics
for all generation operations:

```typescript
import { metrics } from "@opentelemetry/api";
import { axGlobals } from "@ax-llm/ax";

// Set up metrics globally
axGlobals.meter = metrics.getMeter("my-app");

// All AxGen operations now automatically track metrics
const gen = ax("userQuestion:string -> assistantAnswer:string");
const result = await gen.forward(llm, { userQuestion: "Hello!" });
```

### Metrics Tracked

The DSPy metrics system provides comprehensive coverage of your generation
workflows:

#### Generation Performance

- **End-to-end latency**: Total time from input to final output
- **Success/failure rates**: Track generation reliability
- **AI service and model performance**: Compare different providers
- **Signature complexity**: Monitor input/output field counts

#### Multi-step Generation

- **Step counts**: Track how many steps each generation takes
- **Error correction attempts**: Monitor validation and assertion failures
- **Retry patterns**: Understand when and why retries occur
- **Max steps/retries hit**: Identify problematic signatures

#### Function Calling

- **Function execution rates**: Track how often functions are used
- **Unique functions per generation**: Monitor function diversity
- **Function error correction**: Track function-related failures
- **Function calling success rates**: Measure function reliability

#### Streaming Performance

- **Streaming vs non-streaming**: Compare performance modes
- **Delta counts**: Track streaming granularity
- **Finalization latency**: Measure streaming completion time
- **Result picker usage**: Monitor sample selection patterns

#### Performance Breakdown

- **Prompt rendering time**: Measure template processing
- **Memory update latency**: Track context management
- **State creation overhead**: Monitor internal operations
- **Field processing time**: Measure output extraction

## Prompt Optimization

Ax provides powerful automatic optimization that improves your AI programs'
performance, accuracy, and cost-effectiveness.

```typescript
import { ai, ax, AxMiPRO } from "@ax-llm/ax";

// Create a program to optimize
const sentimentAnalyzer = ax(
  'reviewText:string "Customer review" -> sentiment:class "positive, negative, neutral"',
);

// Set up optimizer with examples
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });
const optimizer = new AxMiPRO({
  studentAI: llm,
  examples: [
    { reviewText: "I love this product!", sentiment: "positive" },
    { reviewText: "Terrible quality", sentiment: "negative" },
    { reviewText: "It works fine", sentiment: "neutral" },
  ],
});

// Run optimization with metric
const metric = ({ prediction, example }) =>
  prediction.sentiment === example.sentiment ? 1 : 0;

const result = await optimizer.compile(sentimentAnalyzer, examples, metric);

// Apply optimized configuration
if (result.optimizedProgram) {
  sentimentAnalyzer.applyOptimization(result.optimizedProgram);
  console.log(
    `Improved to ${
      (result.optimizedProgram.bestScore * 100).toFixed(1)
    }% accuracy`,
  );

  // Save for production use
  await fs.writeFile(
    "optimization.json",
    JSON.stringify(result.optimizedProgram, null, 2),
  );
}

// Load in production
import { AxOptimizedProgramImpl } from "@ax-llm/ax";
const savedData = JSON.parse(await fs.readFile("optimization.json", "utf8"));
sentimentAnalyzer.applyOptimization(new AxOptimizedProgramImpl(savedData));
```

For comprehensive documentation on optimization strategies, teacher-student
architectures, and advanced techniques, see our detailed
[**Optimization Guide**](https://github.com/ax-llm/ax/blob/main/OPTIMIZE.md).

## Complete Telemetry Guide

For comprehensive documentation on observability, metrics, tracing, and
monitoring your AI applications with OpenTelemetry integration, see our detailed
[**Telemetry Guide**](https://github.com/ax-llm/ax/blob/main/TELEMETRY.md).

## Built-in Functions

| Function           | Name               | Description                                       |
| ------------------ | ------------------ | ------------------------------------------------- |
| Docker Sandbox     | AxDockerSession    | Execute commands within a docker environment      |
| Embeddings Adapter | AxEmbeddingAdapter | Fetch and pass embedding to your function         |
| JS Interpreter     | AxJSInterpreter    | Execute JS code in a sandboxed env (Node.js only) |

## Check out all the examples

Use the `tsx` command to run the examples. It makes the node run typescript
code. It also supports using an `.env` file to pass the AI API Keys instead of
putting them in the command line.

```shell
OPENAI_APIKEY=api-key npm run tsx ./src/examples/marketing.ts
```

| Example                                                                                                        | Description                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [advanced-rag.ts](https://github.com/ax-llm/ax/blob/main/src/examples/advanced-rag.ts)                         | 🚀 Advanced RAG with multi-hop retrieval, self-healing quality loops, and intelligent query refinement                 |
| [customer-support.ts](https://github.com/ax-llm/ax/blob/main/src/examples/customer-support.ts)                 | Extract valuable details from customer communications                                                                  |
| [debug-logging.ts](https://github.com/ax-llm/ax/blob/main/src/examples/debug-logging.ts)                       | Debug and custom logging examples with different loggers                                                               |
| [function.ts](https://github.com/ax-llm/ax/blob/main/src/examples/function.ts)                                 | Simple single function calling example                                                                                 |
| [food-search.ts](https://github.com/ax-llm/ax/blob/main/src/examples/food-search.ts)                           | Multi-step, multi-function calling example                                                                             |
| [result-picker.ts](https://github.com/ax-llm/ax/blob/main/src/examples/result-picker.ts)                       | Select best result from multiple field-based samples                                                                   |
| [function-result-picker.ts](https://github.com/ax-llm/ax/blob/main/src/examples/function-result-picker.ts)     | Advanced result selection based on function execution                                                                  |
| [marketing.ts](https://github.com/ax-llm/ax/blob/main/src/examples/marketing.ts)                               | Generate short effective marketing sms messages                                                                        |
| [vectordb.ts](https://github.com/ax-llm/ax/blob/main/src/examples/vectordb.ts)                                 | Chunk, embed and search text                                                                                           |
| [fibonacci.ts](https://github.com/ax-llm/ax/blob/main/src/examples/fibonacci.ts)                               | Use the JS code interpreter to compute fibonacci                                                                       |
| [codingWithMemory.ts](https://github.com/ax-llm/ax/blob/main/src/examples/codingWithMemory.ts)                 | Coding assistant with memory and JS interpreter (demonstrates both ax-tools features)                                  |
| [summarize.ts](https://github.com/ax-llm/ax/blob/main/src/examples/summarize.ts)                               | Generate a short summary of a large block of text                                                                      |
| [fluent-signature-example.ts](https://github.com/ax-llm/ax/blob/main/src/examples/fluent-signature-example.ts) | Fluent signature builder using `f()` helpers                                                                           |
| [rag-docs.ts](https://github.com/ax-llm/ax/blob/main/src/examples/rag-docs.ts)                                 | Convert PDF to text and embed for rag search                                                                           |
| [react.ts](https://github.com/ax-llm/ax/blob/main/src/examples/react.ts)                                       | Use function calling and reasoning to answer questions                                                                 |
| [agent.ts](https://github.com/ax-llm/ax/blob/main/src/examples/agent.ts)                                       | Agent framework, agents can use other agents, tools etc                                                                |
| [streaming1.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming1.ts)                             | Output fields validation while streaming                                                                               |
| [streaming2.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming2.ts)                             | Per output field validation while streaming                                                                            |
| [streaming3.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming3.ts)                             | End-to-end streaming example `streamingForward()`                                                                      |
| [smart-home.ts](https://github.com/ax-llm/ax/blob/main/src/examples/smart-home.ts)                             | Agent looks for dog in smart home                                                                                      |
| [multi-modal.ts](https://github.com/ax-llm/ax/blob/main/src/examples/multi-modal.ts)                           | Use an image input along with other text inputs                                                                        |
| [balancer.ts](https://github.com/ax-llm/ax/blob/main/src/examples/balancer.ts)                                 | Balance between various llm's based on cost, etc                                                                       |
| [ax-multiservice-router.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-multiservice-router.ts)     | Type-safe multi-service routing and load balancing with automatic model key inference                                  |
| [vertex-auth-example.ts](https://github.com/ax-llm/ax/blob/main/src/examples/vertex-auth-example.ts)           | Google Vertex AI authentication with dynamic API keys                                                                  |
| [docker.ts](https://github.com/ax-llm/ax/blob/main/src/examples/docker.ts)                                     | Use the docker sandbox to find files by description                                                                    |
| [prime.ts](https://github.com/ax-llm/ax/blob/main/src/examples/prime.ts)                                       | Using field processors to process fields in a prompt                                                                   |
| [simple-classify.ts](https://github.com/ax-llm/ax/blob/main/src/examples/simple-classify.ts)                   | Use a simple classifier to classify stuff                                                                              |
| [mcp-client-memory.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-memory.ts)               | Example of using an MCP server for memory with Ax                                                                      |
| [mcp-client-blender.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-blender.ts)             | Example of using an MCP server for Blender with Ax                                                                     |
| [mcp-client-pipedream.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-pipedream.ts)         | Example of integrating with a remote MCP                                                                               |
| [tune-bootstrap.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-bootstrap.ts)                     | Use bootstrap optimizer to improve prompt efficiency                                                                   |
| [tune-mipro.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-mipro.ts)                             | Use mipro v2 optimizer to improve prompt efficiency                                                                    |
| [mipro-optimize.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mipro-optimize.ts)                     | Complex reasoning optimization with teacher model & save                                                               |
| [mipro-python-optimizer.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mipro-python-optimizer.ts)     | MiPro optimization with Python service integration for advanced Bayesian optimization                                  |
| [mipro-chained-optimize.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mipro-chained-optimize.ts)     | Teacher-student pipeline with cost optimization & overrides                                                            |
| [mipro-use-optimized.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mipro-use-optimized.ts)           | Load and use saved optimization with cheaper models                                                                    |
| [checkpoint-recovery.ts](https://github.com/ax-llm/ax/blob/main/src/examples/checkpoint-recovery.ts)           | Fault-tolerant optimization with checkpoint recovery                                                                   |
| [tune-usage.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-usage.ts)                             | Use the optimized tuned prompts                                                                                        |
| [telemetry.ts](https://github.com/ax-llm/ax/blob/main/src/examples/telemetry.ts)                               | Trace and push traces to a Jaeger service                                                                              |
| [openai-responses.ts](https://github.com/ax-llm/ax/blob/main/src/examples/openai-responses.ts)                 | Example using the new OpenAI Responses API                                                                             |
| [show-thoughts.ts](https://github.com/ax-llm/ax/blob/main/src/examples/show-thoughts.ts)                       | Control and display model reasoning thoughts                                                                           |
| [reasoning-o3-example.ts](https://github.com/ax-llm/ax/blob/main/src/examples/reasoning-o3-example.ts)         | Advanced reasoning with OpenAI o3/o4 models                                                                            |
| [use-examples.ts](https://github.com/ax-llm/ax/blob/main/src/examples/use-examples.ts)                         | Example of using 'examples' to direct the llm                                                                          |
| [metrics-export.ts](https://github.com/ax-llm/ax/blob/main/src/examples/metrics-export.ts)                     | Comprehensive metrics export and observability for generation workflows                                                |
| [optimizer-metrics.ts](https://github.com/ax-llm/ax/blob/main/src/examples/optimizer-metrics.ts)               | Optimizer metrics collection and monitoring for program tuning                                                         |
| [ax-flow.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-flow.ts)                                   | 🚀 Futuristic AI workflow orchestration with autonomous multi-model pipelines, adaptive loops, and self-healing agents |
| [ax-flow-auto-parallel.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-flow-auto-parallel.ts)       | ⚡ Automatic parallelization demo - zero-config performance optimization with intelligent dependency analysis          |
| [ax-flow-enhanced-demo.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-flow-enhanced-demo.ts)       | 🛡️ Production-ready AxFlow with error handling, performance optimization, and enhanced type safety features            |

## Our Goal

Large language models (LLMs) are becoming really powerful and have reached a
point where they can work as the backend for your entire product. However,
there's still a lot of complexity to manage from using the correct prompts,
models, streaming, function calls, error correction, and much more. We aim to
package all this complexity into a well-maintained, easy-to-use library that can
work with all state-of-the-art LLMs. Additionally, we are using the latest
research to add new capabilities like DSPy to the library.

## Tutorial: Your first generator

### 1. Pick an AI to work with

```ts
import { ai } from "@ax-llm/ax";
const llm = ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY as string });
```

### 2. Create a prompt signature based on your usecase

```ts
// Signature defines the inputs and outputs of your prompt program
const cot = ax("question:string -> answer:string");
```

### 3. Execute this new prompt program

```ts
// Pass in the input fields defined in the above signature
const res = await cot.forward(llm, { question: "Are we in a simulation?" });
```

### 4. Or if you just want to directly use the LLM

```ts
const res = await llm.chat([
  { role: "system", content: "Help the customer with his questions" }
  { role: "user", content: "I'm looking for a Macbook Pro M2 With 96GB RAM?" }
]);
```

## How do you use function calling

### 1. Define the functions

```ts
// define one or more functions and a function handler
const functions = [
  {
    name: "getCurrentWeather",
    description: "get the current weather for a location",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "location to get weather for",
        },
        units: {
          type: "string",
          enum: ["imperial", "metric"],
          default: "imperial",
          description: "units to use",
        },
      },
      required: ["location"],
    },
    func: async (args: Readonly<{ location: string; units: string }>) => {
      return `The weather in ${args.location} is 72 degrees`;
    },
  },
];
```

### 2. Pass the functions to a prompt

```ts
const cot = ax("question:string -> answer:string", { functions });
```

## Enable debug logs

```ts
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY as string,
  options: { debug: true },
});
```

## Custom Logger

You can provide a custom logger function to control how debug information and
other messages are output. This is useful for integrating with logging
frameworks or customizing the output format.

```ts
import {
  AxAI,
  axCreateDefaultColorLogger,
  axCreateDefaultTextLogger,
  AxGen,
  type AxLoggerData,
} from "@ax-llm/ax";

// Custom logger that handles structured logger data
const customLogger = (data: AxLoggerData) => {
  const timestamp = new Date().toISOString();

  // Handle different types of log messages
  switch (data.name) {
    case "ChatRequestChatPrompt":
      console.log(`[${timestamp}] Chat request step ${data.step}`);
      break;
    case "ChatResponseResults":
      console.log(`[${timestamp}] Chat response: ${data.value.length} results`);
      break;
    case "FunctionResults":
      console.log(
        `[${timestamp}] Function results: ${data.value.length} calls`,
      );
      break;
    default:
      console.log(`[${timestamp}] ${data.name}:`, JSON.stringify(data.value));
  }
};

// Set logger on AI service
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
  options: {
    debug: true,
    logger: customLogger,
  },
});

// Or set logger on generation programs
const gen = ax(
  "question:string -> answer:string",
  { logger: customLogger },
);

// Logger can also be passed through options
const result = await gen.forward(llm, { question: "Hello" }, {
  logger: customLogger,
});
```

### Built-in Logger Factories

For convenience, Ax provides factory functions to create pre-configured loggers:

```ts
// Create a color logger that outputs to a custom function
const colorLogger = axCreateDefaultColorLogger((message: string) => {
  // Send to your logging system instead of console
  myLoggingSystem.log(message);
});

// Create a text-only logger (no colors)
const textLogger = axCreateDefaultTextLogger((message: string) => {
  fs.appendFileSync("debug.log", message + "\n");
});

const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
  options: {
    debug: true,
    logger: colorLogger,
  },
});
```

The logger function receives structured `AxLoggerData` containing different
types of debug information (chat requests, responses, function calls, etc.). If
no logger is provided, the default color logger is used which outputs to
`console.log`.

## Reach out

We're happy to help reach out if you have questions or join the Discord
[twitter/dosco](https://twitter.com/dosco)

## FAQ

### 1. The LLM can't find the correct function to use

Improve the function naming and description. Be very clear about what the
function does. Also, ensure the function parameters have good descriptions. The
descriptions can be a little short but need to be precise.

### 2. How do I change the configuration of the LLM I'm using?

You can pass a configuration object as the second parameter when creating a new
LLM object.

```ts
// Example: configure a different base URL or model via `ai` options
const llm = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: "gpt-4o" },
});
```

## 3. My prompt is too long / can I change the max tokens?

```ts
// Control max tokens per request
const result = await llm.chat({
  chatPrompt: [{ role: "user", content: "hi" }],
  maxTokens: 2000,
});
```

## 4. How do I change the model? (e.g., I want to use GPT4)

```ts
// Choose a different model in a request
const result = await llm.chat({
  chatPrompt: [{ role: "user", content: "hi" }],
  model: "gpt-4o",
});
```

## Monorepo tips & tricks

It is essential to remember that we should only run `npm install` from the root
directory. This prevents the creation of nested `package-lock.json` files and
avoids non-deduplicated `node_modules`.

[![Ask DeepWiki](https://deepwiki.com/badge.svg?style=for-the-badge)](https://deepwiki.com/ax-llm/ax)

Adding new dependencies in packages should be done with e.g.
`npm install lodash --workspace=ax` (or just modify the appropriate
`package.json` and run `npm install` from root).

## Development Commands

```bash
# Build all workspaces
npm run build

# Run tests across all workspaces
npm run test

# Fix formatting and linting
npm run fix

# Check for circular dependencies (helps maintain clean architecture)
npm run lint:circular

# Run examples with tsx
npm run tsx ./src/examples/<example-file>.ts

# Development mode for specific workspace
npm run dev --workspace=@ax-llm/ax
```
