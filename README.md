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
- Support for thinking budget and though tokens
- Build Agents that can call other agents
- AxFlow workflow orchestration (Beta)
- Built in MCP, Model Context Protocol support
- Convert docs of any format to text
- RAG, smart chunking, embedding, querying
- Works with Vercel AI SDK
- Output validation while streaming
- Multi-modal DSPy supported
- Automatic prompt tuning using optimizers
- OpenTelemetry tracing / observability
- Production ready Typescript code
- Lite weight, zero-dependencies

## Production Ready

- No breaking changes (minor versions)
- Large test coverage
- Builtin Open Telemetry `gen_ai` support
- Widely used by startups in prod

## What's a prompt signature?

<img width="860" alt="shapes at 24-03-31 00 05 55" src="https://github.com/dosco/llm-client/assets/832235/0f0306ea-1812-4a0a-9ed5-76cd908cd26b">

Efficient type-safe prompts are auto-generated from a simple signature. A prompt
signature is made up of a
`"task description" inputField:type "field description" -> "outputField:type`.
The idea behind prompt signatures is based on work done in the
"Demonstrate-Search-Predict" paper.

You can have multiple input and output fields, and each field can be of the
types `string`, `number`, `boolean`, `date`, `datetime`,
`class "class1, class2"`, `code`, `json`, `image`, `audio`, `file`, `url`, or an array of any
of these, e.g., `string[]`. When a type is not defined, it defaults to `string`.

### Field Modifiers

- **Optional fields**: Add `?` after the field name to make it optional (e.g.,
  `fieldName?:string`)
- **Internal fields**: Add `!` after the field name to make it internal - useful
  for reasoning steps that shouldn't be in the final output (e.g.,
  `reasoning!:string`)
- **Combined**: You can combine modifiers (e.g., `optionalReasoning?!:string`)

### Tagged Template Literals (New!)

For a more ergonomic and type-safe way to create signatures, you can use tagged
template literals:

```typescript
import { f, s } from "@ax-llm/ax";

// Basic usage
const sig1 = s`question:string -> answer:string`;

// With field types and descriptions
const sig2 = s`
  input:${f.string("User input")} -> 
  category:${f.class(["tech", "business", "sports"], "Content category")},
  confidence:${f.number("Confidence score 0-1")}
`;

// With modifiers
const sig3 = s`
  text:string -> 
  summary:${f.optional(f.string("Brief summary"))},
  reasoning:${f.internal(f.string("Internal reasoning"))}
`;
```

### Ax Tagged Template Literals

For an even more streamlined experience, you can use the `ax` tagged template
literal to create `AxGen` instances directly:

```typescript
import { ax, f } from "@ax-llm/ax";

// Basic AxGen creation
const gen = ax`question:string -> answer:string`;

// With field types and descriptions
const sentimentGen = ax`
  text:${f.string("Text to analyze")} -> 
  sentiment:${
  f.class(["positive", "negative", "neutral"], "Sentiment classification")
},
  confidence:${f.number("Confidence score 0-1")}
`;

// Direct usage with AI
const result = await sentimentGen.forward(ai, {
  text: "I love this product!",
});
```

The `ax` template literal creates ready-to-use `AxGen` instances. If you need
just the signature, use `s` instead.

## Output Field Types

| Type                        | Description                            | Usage Example                        | Example Output                                     |
| --------------------------- | -------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `string`                    | A sequence of characters               | `fullName:string`                    | `"John Doe"`                                       |
| `number`                    | A numerical value                      | `price:number`                       | `42`                                               |
| `boolean`                   | A true or false value                  | `isValid:boolean`                    | `true`, `false`                                    |
| `date`                      | A date value                           | `startDate:date`                     | `"2023-10-01"`                                     |
| `datetime`                  | A date and time value                  | `createdAt:datetime`                 | `"2023-10-01T12:00:00Z"`                           |
| `json`                      | A JSON object                          | `metadata:json`                      | `{"key": "value"}`                                 |
| `image`                     | An image (input only)                  | `photo:image`                        | Base64 encoded image data                          |
| `audio`                     | An audio file (input only)             | `recording:audio`                    | Base64 encoded audio data                          |
| `file`                      | A file with filename, mime type, and data | `document:file`               | `{"filename": "doc.pdf", "mimeType": "application/pdf", "data": "base64data"}` |
| `url`                       | A URL with optional title and description | `website:url`                | `"https://example.com"` or `{"url": "https://example.com", "title": "Example"}` |
| `class "option1,option2"`   | Classification with predefined options | `category:class "urgent,normal,low"` | `"urgent"`                                         |
| `code`                      | A code block                           | `solution:code "Python solution"`    | `print('Hello, world!')`                           |
| `string[]`                  | An array of strings                    | `tags:string[]`                      | `["example1", "example2"]`                         |
| `number[]`                  | An array of numbers                    | `scores:number[]`                    | `[1, 2, 3]`                                        |
| `boolean[]`                 | An array of boolean values             | `permissions:boolean[]`              | `[true, false, true]`                              |
| `date[]`                    | An array of dates                      | `holidayDates:date[]`                | `["2023-10-01", "2023-10-02"]`                     |
| `datetime[]`                | An array of date and time values       | `logTimestamps:datetime[]`           | `["2023-10-01T12:00:00Z", "2023-10-02T12:00:00Z"]` |
| `file[]`                    | An array of files                      | `attachments:file[]`                 | `[{"filename": "doc1.pdf", "mimeType": "application/pdf", "data": "base64data"}]` |
| `url[]`                     | An array of URLs                       | `links:url[]`                        | `["https://example.com", {"url": "https://test.com", "title": "Test"}]` |
| `class[] "option1,option2"` | Array of classifications               | `categories:class[] "tech,business"` | `["tech", "business"]`                             |

### Important Notes on Field Types

- **Class fields**: Use `class "option1,option2,option3"` to specify the
  available options. The LLM will choose from these predefined options.
- **Code fields**: Use `code "description"` for code blocks. Unlike class
  fields, code fields don't take language parameters in the signature - just a
  description of what code is expected.
- **Arrays**: Add `[]` after any type to make it an array (e.g., `string[]`,
  `class[] "a,b,c"`)
- **Descriptions**: Add quoted descriptions after field types to provide context
  to the LLM

By default, Ax enforces strict naming rules for signature fields. To allow
generic names like `text`, `input`, etc., set
`axGlobals.signatureStrict = false`. Use with caution as it may reduce signature
clarity.

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
  import { ax, AxAI, f } from "https://unpkg.com/@ax-llm/ax@latest";
</script>
```

**Browser CORS Setup:** Most LLM providers require a CORS proxy for browser
usage. See our [browser example](web-chat.html) which includes a simple CORS
proxy setup.

```javascript
const ai = new AxAI({
  name: "openai",
  apiKey: "your-api-key",
  options: {
    corsProxy: "http://localhost:3001", // Your CORS proxy URL
  },
});
```

## Example: Summarize text

```typescript
import { AxAI, ax } from "@ax-llm/ax";

const textToSummarize = `
The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] ...`;

const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY as string,
});

const gen = ax`textToSummarize -> textType:class "note, email, reminder", shortSummary "summarize in 5 to 10 words"`,

const res = await gen.forward(ai, { textToSummarize });

console.log(">", res);
```

## Example: Using tagged template literals for type-safe signatures

```typescript
import { ax, AxAI, f, s } from "@ax-llm/ax";

const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY as string,
});

// Create a signature using tagged template literals
const gen = ax`
    userInput:${f.string("User message or question")} -> 
    category:${f.class(["question", "request", "complaint"], "Message type")},
    priority:${f.class(["high", "medium", "low"], "Urgency level")},
    response:${f.string("Appropriate response")},
    reasoning:${f.internal(f.string("Internal reasoning for classification"))}
  `;

const res = await gen.forward(ai, {
  userInput: "My order hasn't arrived and I need it urgently!",
});

console.log("Category:", res.category);
console.log("Priority:", res.priority);
console.log("Response:", res.response);
// Note: reasoning is internal and won't appear in final output
```

## Example: Building an agent

Use the agent prompt (framework) to build agents that work with other agents to
complete tasks. Agents are easy to make with prompt signatures. Try out the
agent example.

```typescript
# npm run tsx ./src/examples/agent.ts

const researcher = new AxAgent({
  name: 'researcher',
  description: 'Researcher agent',
  signature: `physicsQuestion "physics questions" -> answer "reply in bullet points"`
});

const summarizer = new AxAgent({
  name: 'summarizer',
  description: 'Summarizer agent',
  signature: `text "text so summarize" -> shortSummary "summarize in 5 to 10 words"`
});

const agent = new AxAgent({
  name: 'agent',
  description: 'A an agent to research complex topics',
  signature: `question -> answer`,
  agents: [researcher, summarizer]
});

agent.forward(ai, { questions: "How many atoms are there in the universe" })
```

## Thinking Models Support

Ax provides native support for models with thinking capabilities, allowing you
to control the thinking token budget and access the model's thoughts. This
feature helps in understanding the model's reasoning process and optimizing
token usage.

```typescript
const ai = new AxAI({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: {
    model: AxAIGoogleGeminiModel.Gemini25Flash,
    thinking: { includeThoughts: true },
  },
});

// Or control thinking budget per request
const gen = ax`question -> answer`;
const res = await gen.forward(
  ai,
  { question: "What is quantum entanglement?" },
  { thinkingTokenBudget: "medium" }, // 'minimal', 'low', 'medium', or 'high'
);

// Access thoughts in the response
console.log(res.thoughts); // Shows the model's reasoning process
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
// Create embeddings from text using an LLM
const ret = await this.ai.embed({ texts: "hello world" });

// Create an in memory vector db
const db = new axDB("memory");

// Insert into vector db
await this.db.upsert({
  id: "abc",
  table: "products",
  values: ret.embeddings[0],
});

// Query for similar entries using embeddings
const matches = await this.db.query({
  table: "products",
  values: embeddings[0],
});
```

Alternatively you can use the `AxDBManager` which handles smart chunking,
embedding and querying everything for you, it makes things almost too easy.

```typescript
const manager = new AxDBManager({ ai, db });
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

const gen = ax`question, animalImage:image -> answer`;

const res = await gen.forward(ai, {
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

const gen = new AxGen(`question, commentAudio:audio -> answer`);

const res = await gen.forward(ai, {
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
// Create a chat assistant using modern template literals
const chatBot = ax`
  message:${f.string("A casual message from the user")} -> 
  reply:${f.string("A friendly, casual response")}
`;

// Start a conversation with message history
const chat: AxMessage<{ message: string }>[] = [
  { role: "user", values: { message: "Hi! How are you doing today?" } },
];

// Get first response
let response = await chatBot.forward(ai, chat);
console.log(response.reply);

// Add response to chat history
chat.push({ role: "assistant", values: { message: response.reply as string } });

// Continue conversation with context
chat.push({
  role: "user",
  values: { message: "That's great! Can you tell me a fun fact?" },
});

response = await chatBot.forward(ai, chat);
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
// setup the prompt program
const gen = new AxChainOfThought(
  ai,
  `startNumber:number -> next10Numbers:number[]`,
);

// add a assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined;
}, "Numbers 5 is not allowed");

// run the program with streaming enabled
const res = await gen.forward({ startNumber: 1 }, { stream: true });

// or run the program with end-to-end streaming
const generator = await gen.streamingForward(
  { startNumber: 1 },
  {
    stream: true,
  },
);
for await (const res of generator) {
}
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
  {
    question: "Provide a list of optimizations to speedup LLM inference.",
  },
  { stream: true, debug: true },
);
```

### Field Processors

Field processors are a powerful way to process fields in a prompt. They are used
to process fields in a prompt before the prompt is sent to the LLM.

```typescript
const gen = new AxChainOfThought(
  ai,
  `startNumber:number -> next10Numbers:number[]`,
);

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
const memoryAgent = new AxAgent({
  name: "MemoryAssistant",
  description: "An assistant with persistent memory",
  signature: "input, userId -> response",
  functions: [client], // Pass the client as a function provider
});

// Or use the client with AxGen
const memoryGen = new AxGen("input, userId -> response", {
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
const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY as string,
});

// 4. Create an AxAgent that uses the MCP client
const deepwikiAgent = new AxAgent<
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
const result = await deepwikiAgent.forward(ai, {
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

const gen = ax`inputText -> outputText`;
gen.forward(router, { inputText }, { model: "quick" });
// ax now knows about 'fast' | 'smart' | 'reasoning' | 'quick' | 'advanced'
```

## AxFlow: Build AI Workflows

**AxFlow** makes it easy to build complex AI workflows with automatic parallel
execution and simple, readable code.

### Key Features

- **🚀 Automatic Parallelization**: Runs independent operations in parallel
  automatically
- **🎯 Simple API**: Chainable methods that are easy to read and write
- **🔄 Control Flow**: Loops, branches, and conditional execution
- **🤖 Multi-Model Support**: Use different AI models for different tasks
- **📊 State Management**: Automatic state evolution with full type safety
- **🌊 Streaming Support**: Real-time execution with streaming
- **🔧 Aliases**: Short method names (`.n()`, `.e()`, `.m()`) for rapid
  development

### Basic Example: Document Analysis

```typescript
import { AxAI, AxFlow } from "@ax-llm/ax";

const ai = AxAI.create({ name: "openai", apiKey: process.env.OPENAI_APIKEY });

// Simple document analysis workflow
const documentAnalyzer = new AxFlow<
  { documentText: string },
  { summary: string; sentiment: string; keywords: string[] }
>()
  .node("summarizer", "documentText:string -> summary:string")
  .node("sentimentAnalyzer", "documentText:string -> sentiment:string")
  .node("keywordExtractor", "documentText:string -> keywords:string[]")
  // These three operations run automatically in parallel! ⚡
  .execute("summarizer", (state) => ({ documentText: state.documentText }))
  .execute(
    "sentimentAnalyzer",
    (state) => ({ documentText: state.documentText }),
  )
  .execute(
    "keywordExtractor",
    (state) => ({ documentText: state.documentText }),
  )
  // Combine results
  .map((state) => ({
    summary: state.summarizerResult.summary,
    sentiment: state.sentimentAnalyzerResult.sentiment,
    keywords: state.keywordExtractorResult.keywords,
  }));

// Execute the workflow
const result = await documentAnalyzer.forward(ai, {
  documentText: "AI technology is revolutionary and will change everything...",
});

console.log("Summary:", result.summary);
console.log("Sentiment:", result.sentiment);
console.log("Keywords:", result.keywords);
```

### Compact Syntax with Aliases

For rapid development, use AxFlow's short aliases:

```typescript
// Same functionality, ultra-compact syntax
const quickAnalyzer = new AxFlow<{ text: string }, { result: string }>()
  .n("sum", "text:string -> summary:string") // .n() = .node()
  .n("sent", "text:string -> sentiment:string") // .n() = .node()
  .e("sum", (s) => ({ text: s.text })) // .e() = .execute()
  .e("sent", (s) => ({ text: s.text })) // .e() = .execute()
  .m((s) => ({ // .m() = .map()
    result:
      `Summary: ${s.sumResult.summary}, Sentiment: ${s.sentResult.sentiment}`,
  }));

const result = await quickAnalyzer.forward(ai, {
  text: "Building the future of AI applications...",
});
```

### Multi-Model Intelligence

Use different AI models for different tasks:

```typescript
const fastAI = AxAI.create({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  models: [
    {
      key: "fast" as const,
      model: "gpt-4o-mini",
      description: "Fast responses",
    },
  ],
});

const powerAI = AxAI.create({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
  models: [
    {
      key: "power" as const,
      model: "gpt-4o",
      description: "High-quality responses",
    },
  ],
});

// 🌟 The future: AI workflows that adapt and evolve with full resilience
const autonomousContentEngine = new AxFlow<
  { concept: string; targetAudience: string },
  { campaign: string }
>(
  {
    errorHandling: {
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60000 },
      fallbackStrategy: "graceful",
    },
    performance: {
      maxConcurrency: 4,
      adaptiveConcurrency: true,
      resourceMonitoring: { responseTimeThreshold: 10000 },
    },
  },
)
  // Neural network of specialized AI nodes
  .node(
    "conceptAnalyzer",
    "concept:string -> themes:string[], complexity:number",
  )
  .node("audienceProfiler", "audience:string -> psychographics:string")
  .node(
    "strategyArchitect",
    "themes:string[], psychographics:string -> strategy:string",
  )
  .node(
    "contentCreator",
    "strategy:string, complexity:number -> content:string",
  )
  .node("qualityOracle", "content:string -> score:number, feedback:string")
  // 🧠 These run automatically in parallel (different AI models!)
  .execute("conceptAnalyzer", (s) => ({ concept: s.concept }), {
    ai: quantumAI,
  })
  .execute("audienceProfiler", (s) => ({ audience: s.targetAudience }), {
    ai: velocityAI,
  })
  // 🎯 Strategic architecture with deep reasoning (waits for above)
  .execute("strategyArchitect", (s) => ({
    themes: s.conceptAnalyzerResult.themes,
    psychographics: s.audienceProfilerResult.psychographics,
  }), { ai: quantumAI })
  // 🎨 Creative content generation (waits for strategy)
  .execute("contentCreator", (s) => ({
    strategy: s.strategyArchitectResult.strategy,
    complexity: s.conceptAnalyzerResult.complexity,
  }), { ai: creativityAI })
  // 🔄 Quality check loop
  .label("evolve")
  .execute(
    "qualityOracle",
    (s) => ({ content: s.contentCreatorResult.content }),
    { ai: quantumAI },
  )
  .feedback((s) => s.qualityOracleResult.score < 0.9, "evolve", 3)
  // 🏆 Final transformation
  .map((s) => ({ campaign: s.contentCreatorResult.content }));

// 🚀 Execute the future
const result = await autonomousContentEngine.forward(quantumAI, {
  concept: "Sustainable AI for climate solutions",
  targetAudience: "Tech-forward environmental activists",
});

console.log("🌟 Autonomous Campaign Generated:", result.campaign);
```

### Advanced Example: Self-Healing Research Pipeline

```typescript
// 🔬 Autonomous research agent with advanced error recovery
const researchOracle = new AxFlow<
  { researchQuery: string },
  { insights: string; confidence: number }
>(
  {
    errorHandling: {
      maxRetries: 5,
      backoffType: "exponential",
      circuitBreaker: { failureThreshold: 4, resetTimeoutMs: 45000 },
      isolateErrors: true,
    },
    performance: {
      maxConcurrency: 3,
      resourceLimits: { tokensPerMinute: 30000 },
    },
  },
)
  .n("queryExpander", "query:string -> expandedQueries:string[]")
  .n("knowledgeHarvester", "queries:string[] -> rawData:string[]")
  .n(
    "insightSynthesizer",
    "data:string[] -> insights:string, confidence:number",
  )
  .n("validityChecker", "insights:string -> isValid:boolean, issues:string[]")
  // 📡 Query expansion with exponential search
  .e("queryExpander", (s) => ({ query: s.researchQuery }))
  // 🌐 Parallel knowledge harvesting
  .wh((s) => s.queryExpanderResult.expandedQueries.length > 0, 5)
  .e(
    "knowledgeHarvester",
    (s) => ({ queries: s.queryExpanderResult.expandedQueries }),
  )
  .e(
    "insightSynthesizer",
    (s) => ({ data: s.knowledgeHarvesterResult.rawData }),
  )
  .e(
    "validityChecker",
    (s) => ({ insights: s.insightSynthesizerResult.insights }),
  )
  // 🔧 Self-healing: regenerate if confidence too low
  .b((s) => s.insightSynthesizerResult.confidence > 0.8)
  .w(true).m((s) => ({ finalInsights: s.insightSynthesizerResult.insights }))
  .w(false).m((s) => ({
    queryExpanderResult: { expandedQueries: ["refined query based on issues"] },
  }))
  .merge()
  .end()
  .m((s) => ({
    insights: s.finalInsights || "Research incomplete",
    confidence: s.insightSynthesizerResult?.confidence || 0,
  }));
```

### Why AxFlow is the Future

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

- **Circuit Breakers**: Automatic failure detection and recovery
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

### NEW: Parallel Map with Batch Size Control

Execute multiple transformations in parallel with intelligent batch processing
for optimal resource management:

```typescript
import { AxFlow } from "@ax-llm/ax";

// Configure batch processing for optimal performance
const flow = new AxFlow<StateType, ResultType>({
  batchSize: 5, // Process 5 operations at a time
})
  .init({ data: largeDataset })
  // Execute multiple transforms in parallel with automatic batching
  .map([
    (state) => ({ ...state, analysis1: analyzeData(state.data) }),
    (state) => ({ ...state, analysis2: extractFeatures(state.data) }),
    (state) => ({ ...state, analysis3: generateSummary(state.data) }),
    (state) => ({ ...state, analysis4: calculateMetrics(state.data) }),
    (state) => ({ ...state, analysis5: validateResults(state.data) }),
  ], { parallel: true })
  .map((state) => ({
    final: combineResults([
      state.analysis1,
      state.analysis2,
      state.analysis3,
      state.analysis4,
      state.analysis5,
    ]),
  }));

// ⚡ Automatic batch processing: runs 5 operations concurrently,
// then processes remaining operations, maintaining result order
const result = await flow.forward(ai, { data: dataset });
```

**🚀 Benefits:**

- **Resource Control**: Prevent memory spikes with large parallel operations
- **Order Preservation**: Results maintain original order despite batched
  execution
- **Performance Tuning**: Optimize batch size for different deployment
  environments
- **Rate Limiting**: Works seamlessly with API rate limits and service quotas

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
const gen = new AxGen(`question -> answer`);
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
const gen = new AxGen(`question -> answer`);
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

const ai = new AxAI({
  name: "ollama",
  config: { model: "nous-hermes2" },
  options: { tracer },
});

const gen = new AxChainOfThought(
  ai,
  `text -> shortSummary "summarize in 5 to 10 words"`,
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
const gen = new AxGen("userQuestion:string -> assistantAnswer:string");
const result = await gen.forward(ai, { userQuestion: "Hello!" });
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

## Tuning the prompts (Basic)

You can tune your prompts using a larger model to help them run more efficiently
and give you better results. This is done by using an optimizer like
`AxBootstrapFewShot` with and examples from the popular `HotPotQA` dataset. The
optimizer generates demonstrations `demos` which when used with the prompt help
improve its efficiency.

```typescript
// Download the HotPotQA dataset from huggingface
const hf = new AxHFDataLoader({
  dataset: "hotpot_qa",
  split: "train",
});

const examples = await hf.getData<{ question: string; answer: string }>({
  count: 100,
  fields: ["question", "answer"],
});

const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY as string,
});

// Setup the program to tune
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`,
);

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new AxBootstrapFewShot({
  studentAI: ai,
  examples,
  options: {
    maxRounds: 3,
    maxDemos: 4,
    verboseMode: true,
  },
});

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) =>
  emScore(prediction.answer as string, example.answer as string);

// Run the optimizer and remember to save the result to use later
const result = await optimize.compile(program, metricFn);

// Save the generated demos to a file
// import fs from 'fs'; // Ensure fs is imported in your actual script
fs.writeFileSync("bootstrap-demos.json", JSON.stringify(result.demos, null, 2));
console.log("Demos saved to bootstrap-demos.json");
```

<img width="853" alt="tune-prompt" src="https://github.com/dosco/llm-client/assets/832235/f924baa7-8922-424c-9c2c-f8b2018d8d74">
```

## Tuning the prompts (Advanced, Mipro v2)

MiPRO v2 is an advanced prompt optimization framework that uses Bayesian
optimization to automatically find the best instructions, demonstrations, and
examples for your LLM programs. By systematically exploring different prompt
configurations, MiPRO v2 helps maximize model performance without manual tuning.

### Key Features

- **Instruction optimization**: Automatically generates and tests multiple
  instruction candidates
- **Few-shot example selection**: Finds optimal demonstrations from your dataset
- **Smart Bayesian optimization**: Uses UCB (Upper Confidence Bound) strategy to
  efficiently explore configurations
- **Early stopping**: Stops optimization when improvements plateau to save
  compute
- **Program and data-aware**: Considers program structure and dataset
  characteristics

### How It Works

1. Generates various instruction candidates
2. Bootstraps few-shot examples from your data
3. Selects labeled examples directly from your dataset
4. Uses Bayesian optimization to find the optimal combination
5. Applies the best configuration to your program

### Basic Usage

```typescript
import { AxAI, AxChainOfThought, AxMiPRO } from "@ax-llm/ax";

// 1. Setup your AI service
const ai = new AxAI({
  name: "google-gemini",
  apiKey: process.env.GOOGLE_APIKEY,
});

// 2. Create your program
const program = new AxChainOfThought(`input -> output`);

// 3. Configure the optimizer
const optimizer = new AxMiPRO({
  studentAI: ai,
  examples: trainingData, // Your training examples
  options: {
    numTrials: 20, // Number of configurations to try
    verbose: true,
  },
});

// 4. Define your evaluation metric
const metricFn = ({ prediction, example }) => {
  return prediction.output === example.output;
};

// 5. Run the optimization
const result = await optimizer.compile(program, metricFn, {
  valset: validationData, // Optional validation set
  auto: "medium", // Optimization level
});

// 6. Use the optimized program
const result = await optimizedProgram.forward(ai, { input: "test input" });
```

### Configuration Options

MiPRO v2 provides extensive configuration options:

| Option                    | Description                                   | Default |
| ------------------------- | --------------------------------------------- | ------- |
| `numCandidates`           | Number of instruction candidates to generate  | 5       |
| `numTrials`               | Number of optimization trials                 | 30      |
| `maxBootstrappedDemos`    | Maximum number of bootstrapped demonstrations | 3       |
| `maxLabeledDemos`         | Maximum number of labeled examples            | 4       |
| `minibatch`               | Use minibatching for faster evaluation        | true    |
| `minibatchSize`           | Size of evaluation minibatches                | 25      |
| `earlyStoppingTrials`     | Stop if no improvement after N trials         | 5       |
| `minImprovementThreshold` | Minimum score improvement threshold           | 0.01    |
| `programAwareProposer`    | Use program structure for better proposals    | true    |
| `dataAwareProposer`       | Consider dataset characteristics              | true    |
| `verbose`                 | Show detailed optimization progress           | false   |
| abort-patterns.ts         | Example on how to abort requests              |         |

### Optimization Levels

You can quickly configure optimization intensity with the `auto` parameter:

```typescript
// Light optimization (faster, less thorough)
const result = await optimizer.compile(program, metricFn, { auto: "light" });

// Medium optimization (balanced)
const result = await optimizer.compile(program, metricFn, { auto: "medium" });

// Heavy optimization (slower, more thorough)
const result = await optimizer.compile(program, metricFn, { auto: "heavy" });
```

### Advanced Example: Sentiment Analysis

```typescript
// Create sentiment analysis program
const classifyProgram = new AxChainOfThought<
  { productReview: string },
  { label: string }
>(`productReview -> label:string "positive" or "negative"`);

// Configure optimizer with advanced settings
const optimizer = new AxMiPRO({
  studentAI: ai,
  examples: trainingData,
  options: {
    numCandidates: 3,
    numTrials: 10,
    maxBootstrappedDemos: 2,
    maxLabeledDemos: 3,
    earlyStoppingTrials: 3,
    programAwareProposer: true,
    dataAwareProposer: true,
    verbose: true,
  },
});

// Run optimization and save the result
const result = await optimizer.compile(classifyProgram, metricFn, {
  valset: validationData,
});

// Save configuration for future use
const programConfig = JSON.stringify(optimizedProgram, null, 2);
await fs.promises.writeFile("./optimized-config.json", programConfig);
console.log("> Done. Optimized program config saved to optimized-config.json");
```

## Using the Tuned Prompts

Both the basic Bootstrap Few Shot optimizer and the advanced MiPRO v2 optimizer
generate **demos** (demonstrations) that significantly improve your program's
performance. These demos are examples that show the LLM how to properly handle
similar tasks.

### What are Demos?

Demos are input-output examples that get automatically included in your prompts
to guide the LLM. They act as few-shot learning examples, showing the model the
expected behavior for your specific task.

### Loading and Using Demos

Whether you used Bootstrap Few Shot or MiPRO v2, the process of using the
generated demos is the same:

```typescript
import fs from "fs";
import { AxAI, AxChainOfThought, AxGen } from "@ax-llm/ax";

// 1. Setup your AI service
const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
});

// 2. Create your program (same signature as used during tuning)
const program = new AxChainOfThought(
  `question -> answer "in short 2 or 3 words"`,
);

// 3. Load the demos from the saved file
const demos = JSON.parse(fs.readFileSync("bootstrap-demos.json", "utf8"));

// 4. Apply the demos to your program
program.setDemos(demos);

// 5. Use your enhanced program
const result = await program.forward(ai, {
  question: "What castle did David Gregory inherit?",
});

console.log(result); // Now performs better with the learned examples
```

### Simple Example: Text Classification

Here's a complete example showing how demos improve a classification task:

```typescript
// Create a classification program
const classifier = new AxGen(
  `text -> category:class "positive, negative, neutral"`,
);

// Load demos generated from either Bootstrap or MiPRO tuning
const savedDemos = JSON.parse(
  fs.readFileSync("classification-demos.json", "utf8"),
);
classifier.setDemos(savedDemos);

// Now the classifier has learned from examples and performs better
const result = await classifier.forward(ai, {
  text: "This product exceeded my expectations!",
});

console.log(result.category); // More accurate classification
```

### Key Benefits of Using Demos

- **Improved Accuracy**: Programs perform significantly better with relevant
  examples
- **Consistent Output**: Demos help maintain consistent response formats

- **Reduced Hallucination**: Examples guide the model toward expected behaviors
- **Cost Effective**: Better results without needing larger/more expensive
  models

### Best Practices

1. **Save Your Demos**: Always save generated demos to files for reuse
2. **Match Signatures**: Use the exact same signature when loading demos
3. **Version Control**: Keep demo files in version control for reproducibility
4. **Regular Updates**: Re-tune periodically with new data to improve demos

Both Bootstrap Few Shot and MiPRO v2 generate demos in the same format, so you
can use this same loading pattern regardless of which optimizer you used for
tuning.

## Complete Optimization Guide

For comprehensive documentation on optimization strategies, teacher-student
architectures, cost management, and advanced techniques, see our detailed
[**Optimization Guide**](https://github.com/ax-llm/ax/blob/main/OPTIMIZE.md).

## Complete AxFlow Guide

For comprehensive documentation on building complex AI workflows, multi-model
orchestration, control flow patterns, and production-ready systems, see our
detailed [**AxFlow Guide**](https://github.com/ax-llm/ax/blob/main/AXFLOW.md).

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

| Example                                                                                                    | Description                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [customer-support.ts](https://github.com/ax-llm/ax/blob/main/src/examples/customer-support.ts)             | Extract valuable details from customer communications                                                                  |
| [debug-logging.ts](https://github.com/ax-llm/ax/blob/main/src/examples/debug-logging.ts)                   | Debug and custom logging examples with different loggers                                                               |
| [function.ts](https://github.com/ax-llm/ax/blob/main/src/examples/function.ts)                             | Simple single function calling example                                                                                 |
| [food-search.ts](https://github.com/ax-llm/ax/blob/main/src/examples/food-search.ts)                       | Multi-step, multi-function calling example                                                                             |
| [result-picker.ts](https://github.com/ax-llm/ax/blob/main/src/examples/result-picker.ts)                   | Select best result from multiple field-based samples                                                                   |
| [function-result-picker.ts](https://github.com/ax-llm/ax/blob/main/src/examples/function-result-picker.ts) | Advanced result selection based on function execution                                                                  |
| [marketing.ts](https://github.com/ax-llm/ax/blob/main/src/examples/marketing.ts)                           | Generate short effective marketing sms messages                                                                        |
| [vectordb.ts](https://github.com/ax-llm/ax/blob/main/src/examples/vectordb.ts)                             | Chunk, embed and search text                                                                                           |
| [fibonacci.ts](https://github.com/ax-llm/ax/blob/main/src/examples/fibonacci.ts)                           | Use the JS code interpreter to compute fibonacci                                                                       |
| [codingWithMemory.ts](https://github.com/ax-llm/ax/blob/main/src/examples/codingWithMemory.ts)             | Coding assistant with memory and JS interpreter (demonstrates both ax-tools features)                                  |
| [summarize.ts](https://github.com/ax-llm/ax/blob/main/src/examples/summarize.ts)                           | Generate a short summary of a large block of text                                                                      |
| [chain-of-thought.ts](https://github.com/ax-llm/ax/blob/main/src/examples/chain-of-thought.ts)             | Use chain-of-thought prompting to answer questions                                                                     |
| [template-signatures.ts](https://github.com/ax-llm/ax/blob/main/src/examples/template-signatures.ts)       | Type-safe signatures using tagged template literals                                                                    |
| [ax-template.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-template.ts)                       | Create AxGen instances using tagged template literals                                                                  |
| [rag.ts](https://github.com/ax-llm/ax/blob/main/src/examples/rag.ts)                                       | Use multi-hop retrieval to answer questions                                                                            |
| [rag-docs.ts](https://github.com/ax-llm/ax/blob/main/src/examples/rag-docs.ts)                             | Convert PDF to text and embed for rag search                                                                           |
| [react.ts](https://github.com/ax-llm/ax/blob/main/src/examples/react.ts)                                   | Use function calling and reasoning to answer questions                                                                 |
| [agent.ts](https://github.com/ax-llm/ax/blob/main/src/examples/agent.ts)                                   | Agent framework, agents can use other agents, tools etc                                                                |
| [streaming1.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming1.ts)                         | Output fields validation while streaming                                                                               |
| [streaming2.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming2.ts)                         | Per output field validation while streaming                                                                            |
| [streaming3.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming3.ts)                         | End-to-end streaming example `streamingForward()`                                                                      |
| [smart-hone.ts](https://github.com/ax-llm/ax/blob/main/src/examples/smart-hone.ts)                         | Agent looks for dog in smart home                                                                                      |
| [multi-modal.ts](https://github.com/ax-llm/ax/blob/main/src/examples/multi-modal.ts)                       | Use an image input along with other text inputs                                                                        |
| [balancer.ts](https://github.com/ax-llm/ax/blob/main/src/examples/balancer.ts)                             | Balance between various llm's based on cost, etc                                                                       |
| [ax-multiservice-router.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-multiservice-router.ts) | Type-safe multi-service routing and load balancing with automatic model key inference                                  |
| [vertex-auth-example.ts](https://github.com/ax-llm/ax/blob/main/src/examples/vertex-auth-example.ts)       | Google Vertex AI authentication with dynamic API keys                                                                  |
| [docker.ts](https://github.com/ax-llm/ax/blob/main/src/examples/docker.ts)                                 | Use the docker sandbox to find files by description                                                                    |
| [prime.ts](https://github.com/ax-llm/ax/blob/main/src/examples/prime.ts)                                   | Using field processors to process fields in a prompt                                                                   |
| [simple-classify.ts](https://github.com/ax-llm/ax/blob/main/src/examples/simple-classify.ts)               | Use a simple classifier to classify stuff                                                                              |
| [mcp-client-memory.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-memory.ts)           | Example of using an MCP server for memory with Ax                                                                      |
| [mcp-client-blender.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-blender.ts)         | Example of using an MCP server for Blender with Ax                                                                     |
| [mcp-client-pipedream.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-pipedream.ts)     | Example of integrating with a remote MCP                                                                               |
| [tune-bootstrap.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-bootstrap.ts)                 | Use bootstrap optimizer to improve prompt efficiency                                                                   |
| [tune-mipro.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-mipro.ts)                         | Use mipro v2 optimizer to improve prompt efficiency                                                                    |
| [mipro-optimize.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mipro-optimize.ts)                 | Complex reasoning optimization with teacher model & save                                                               |
| [mipro-chained-optimize.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mipro-chained-optimize.ts) | Teacher-student pipeline with cost optimization & overrides                                                            |
| [mipro-use-optimized.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mipro-use-optimized.ts)       | Load and use saved optimization with cheaper models                                                                    |
| [checkpoint-recovery.ts](https://github.com/ax-llm/ax/blob/main/src/examples/checkpoint-recovery.ts)       | Fault-tolerant optimization with checkpoint recovery                                                                   |
| [tune-usage.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-usage.ts)                         | Use the optimized tuned prompts                                                                                        |
| [telemetry.ts](https://github.com/ax-llm/ax/blob/main/src/examples/telemetry.ts)                           | Trace and push traces to a Jaeger service                                                                              |
| [openai-responses.ts](https://github.com/ax-llm/ax/blob/main/src/examples/openai-responses.ts)             | Example using the new OpenAI Responses API                                                                             |
| [show-thoughts.ts](https://github.com/ax-llm/ax/blob/main/src/examples/show-thoughts.ts)                   | Control and display model reasoning thoughts                                                                           |
| [reasoning-o3-example.ts](https://github.com/ax-llm/ax/blob/main/src/examples/reasoning-o3-example.ts)     | Advanced reasoning with OpenAI o3/o4 models                                                                            |
| [use-examples.ts](https://github.com/ax-llm/ax/blob/main/src/examples/use-examples.ts)                     | Example of using 'examples' to direct the llm                                                                          |
| [thinking-token-budget.ts](https://github.com/ax-llm/ax/blob/main/src/examples/thinking-token-budget.ts)   | Configurable thinking token budget levels for Google Gemini and reasoning control                                      |
| [metrics-dspy.ts](https://github.com/ax-llm/ax/blob/main/src/examples/metrics-dspy.ts)                     | Comprehensive DSPy metrics tracking and observability for generation workflows                                         |
| [optimizer-metrics.ts](https://github.com/ax-llm/ax/blob/main/src/examples/optimizer-metrics.ts)           | Optimizer metrics collection and monitoring for program tuning                                                         |
| [ax-flow.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-flow.ts)                               | 🚀 Futuristic AI workflow orchestration with autonomous multi-model pipelines, adaptive loops, and self-healing agents |
| [ax-flow-auto-parallel.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-flow-auto-parallel.ts)   | ⚡ Automatic parallelization demo - zero-config performance optimization with intelligent dependency analysis          |
| [ax-flow-enhanced-demo.ts](https://github.com/ax-llm/ax/blob/main/src/examples/ax-flow-enhanced-demo.ts)   | 🛡️ Production-ready AxFlow with error handling, performance optimization, and enhanced type safety features            |

## Our Goal

Large language models (LLMs) are becoming really powerful and have reached a
point where they can work as the backend for your entire product. However,
there's still a lot of complexity to manage from using the correct prompts,
models, streaming, function calls, error correction, and much more. We aim to
package all this complexity into a well-maintained, easy-to-use library that can
work with all state-of-the-art LLMs. Additionally, we are using the latest
research to add new capabilities like DSPy to the library.

## How to use this library?

### 1. Pick an AI to work with

```ts
// Pick a LLM
const ai = new AxOpenAI({ apiKey: process.env.OPENAI_APIKEY } as AxOpenAIArgs);
```

### 2. Create a prompt signature based on your usecase

```ts
// Signature defines the inputs and outputs of your prompt program
const cot = new ChainOfThought(ai, `question:string -> answer:string`, { mem });
```

### 3. Execute this new prompt program

```ts
// Pass in the input fields defined in the above signature
const res = await cot.forward({ question: "Are we in a simulation?" });
```

### 4. Or if you just want to directly use the LLM

```ts
const res = await ai.chat([
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
const cot = new AxGen(ai, `question:string -> answer:string`, { functions });
```

## Enable debug logs

```ts
const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
} as AxOpenAIArgs);
ai.setOptions({ debug: true });
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
const ai = new AxAI({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY,
  options: {
    debug: true,
    logger: customLogger,
  },
});

// Or set logger on generation programs
const gen = new AxGen(
  "question -> answer:string",
  { logger: customLogger },
);

// Logger can also be passed through options
const result = await gen.forward(ai, { question: "Hello" }, {
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

const ai = new AxAI({
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
const apiKey = process.env.OPENAI_APIKEY;
const conf = AxOpenAIBestConfig();
const ai = new AxOpenAI({ apiKey, conf } as AxOpenAIArgs);
```

## 3. My prompt is too long / can I change the max tokens?

```ts
const conf = axOpenAIDefaultConfig(); // or OpenAIBestOptions()
conf.maxTokens = 2000;
```

## 4. How do I change the model? (e.g., I want to use GPT4)

```ts
const conf = axOpenAIDefaultConfig(); // or OpenAIBestOptions()
conf.model = OpenAIModel.GPT4Turbo;
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
