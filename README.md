# Ax, DSPy for Typescript

Working with LLMs is complex they don't always do what you want. DSPy makes it easier to build amazing things with LLMs. Just define your inputs and outputs (signature) and an efficient prompt is auto-generated and used. Connect together various signatures to build complex systems and workflows using LLMs

And to help you really use this in production we have everything else you need like observability, streaming, support for other modalities (images,audio, etc), error-correction, multi-step function calling, MCP, RAG, etc


[![NPM Package](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=green)](https://www.npmjs.com/package/@ax-llm/ax)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://dcbadge.vercel.app/api/server/DSHg3dU7dW?style=for-the-badge)](https://discord.gg/DSHg3dU7dW)


<!-- header -->

## Why use Ax?

- Standard interface across all top LLMs
- Prompts compiled from simple signatures
- Full native end-to-end streaming
- Support for thinking budget and though tokens
- Build Agents that can call other agents
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
`class "class1, class2"`, `JSON`, or an array of any of these, e.g., `string[]`.
When a type is not defined, it defaults to `string`. The suffix `?` makes the
field optional (required by default) and `!` makes the field internal which is
good for things like reasoning.

## Output Field Types

| Type                      | Description                         | Usage                      | Example Output                                     |
| ------------------------- | ----------------------------------- | -------------------------- | -------------------------------------------------- |
| `string`                  | A sequence of characters.           | `fullName:string`          | `"example"`                                        |
| `number`                  | A numerical value.                  | `price:number`             | `42`                                               |
| `boolean`                 | A true or false value.              | `isEvent:boolean`          | `true`, `false`                                    |
| `date`                    | A date value.                       | `startDate:date`           | `"2023-10-01"`                                     |
| `datetime`                | A date and time value.              | `createdAt:datetime`       | `"2023-10-01T12:00:00Z"`                           |
| `class "class1,class2"`   | A classification of items.          | `category:class`           | `["class1", "class2", "class3"]`                   |
| `string[]`                | An array of strings.                | `tags:string[]`            | `["example1", "example2"]`                         |
| `number[]`                | An array of numbers.                | `scores:number[]`          | `[1, 2, 3]`                                        |
| `boolean[]`               | An array of boolean values.         | `permissions:boolean[]`    | `[true, false, true]`                              |
| `date[]`                  | An array of dates.                  | `holidayDates:date[]`      | `["2023-10-01", "2023-10-02"]`                     |
| `datetime[]`              | An array of date and time values.   | `logTimestamps:datetime[]` | `["2023-10-01T12:00:00Z", "2023-10-02T12:00:00Z"]` |
| `class[] "class1,class2"` | Multiple classes                    | `categories:class[]`       | `["class1", "class2", "class3"]`                   |
| `code "language"`         | A code block in a specific language | `code:code "python"`       | `print('Hello, world!')`                           |

## LLMs Supported

`Google Gemini`, `OpenAI`, `Azure OpenAI`, `Anthropic`, `X Grok`, `TogetherAI`, `Cohere`, `Mistral`, `Groq`, `DeepSeek`, `Ollama`, `Reka`,
`Hugging Face`

## Install

```bash
npm install @ax-llm/ax
# or
yarn add @ax-llm/ax
```

## Example: Using chain-of-thought to summarize text

```typescript
import { AxAI, AxChainOfThought } from '@ax-llm/ax'

const textToSummarize = `
The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] ...`

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

const gen = new AxChainOfThought(
  `textToSummarize -> textType:class "note, email, reminder", shortSummary "summarize in 5 to 10 words"`
)

const res = await gen.forward(ai, { textToSummarize })

console.log('>', res)
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

Ax provides native support for models with thinking capabilities, allowing you to control the thinking token budget and access the model's thoughts. This feature helps in understanding the model's reasoning process and optimizing token usage.

```typescript
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: {
    model: AxAIGoogleGeminiModel.Gemini25Flash,
    thinking: { includeThoughts: true },
  },
})

// Or control thinking budget per request
const gen = new AxChainOfThought(`question -> answer`)
const res = await gen.forward(
  ai,
  { question: 'What is quantum entanglement?' },
  { thinkingTokenBudget: 'medium' } // 'minimal', 'low', 'medium', or 'high'
)

// Access thoughts in the response
console.log(res.thoughts) // Shows the model's reasoning process
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
const ret = await this.ai.embed({ texts: 'hello world' })

// Create an in memory vector db
const db = new axDB('memory')

// Insert into vector db
await this.db.upsert({
  id: 'abc',
  table: 'products',
  values: ret.embeddings[0],
})

// Query for similar entries using embeddings
const matches = await this.db.query({
  table: 'products',
  values: embeddings[0],
})
```

Alternatively you can use the `AxDBManager` which handles smart chunking,
embedding and querying everything for you, it makes things almost too easy.

```typescript
const manager = new AxDBManager({ ai, db })
await manager.insert(text)

const matches = await manager.query(
  'John von Neumann on human intelligence and singularity.'
)
console.log(matches)
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
const tika = new AxApacheTika()
const text = await tika.convert('/path/to/document.pdf')

const manager = new AxDBManager({ ai, db })
await manager.insert(text)

const matches = await manager.query('Find some text')
console.log(matches)
```

## Multi-modal DSPy

When using models like `GPT-4o` and `Gemini` that support multi-modal prompts,
we support using image fields, and this works with the whole DSP pipeline.

```typescript
const image = fs
  .readFileSync('./src/examples/assets/kitten.jpeg')
  .toString('base64')

const gen = new AxChainOfThought(`question, animalImage:image -> answer`)

const res = await gen.forward(ai, {
  question: 'What family does this animal belong to?',
  animalImage: { mimeType: 'image/jpeg', data: image },
})
```

When using models like `gpt-4o-audio-preview` that support multi-modal prompts
with audio support, we support using audio fields, and this works with the whole
DSP pipeline.

```typescript
const audio = fs
  .readFileSync('./src/examples/assets/comment.wav')
  .toString('base64')

const gen = new AxGen(`question, commentAudio:audio -> answer`)

const res = await gen.forward(ai, {
  question: 'What family does this animal belong to?',
  commentAudio: { format: 'wav', data: audio },
})
```

## DSPy Chat API

Inspired by DSPy's demonstration weaving, Ax provides `AxMessage` for seamless conversation history management. This allows you to build chatbots and conversational agents that maintain context across multiple turns while leveraging the full power of prompt signatures. See the example for more details.

```shell
GOOGLE_APIKEY=api-key npm run tsx ./src/examples/chat.ts
```

```typescript
const chatBot = new AxGen<
  { message: string } | ReadonlyArray<ChatMessage>,
  { reply: string }
>(
  `message:string "A casual message from the user" -> reply:string "A friendly, casual response"`
)

await chatBot.forward(ai, [
  {
    role: 'user',
    values: { message: 'Hi! How are you doing today?' },
  },
  {
    role: 'assistant',
    values: { message: 'I am doing great! How about you?' },
  },
  {
    role: 'user',
    values: { message: 'Thats great!' },
  },
])
```

The conversation history is automatically woven into the prompt, allowing the model to maintain context and provide coherent responses. This works seamlessly with all Ax features including streaming, function calling, and chain-of-thought reasoning.

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
  `startNumber:number -> next10Numbers:number[]`
)

// add a assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined
}, 'Numbers 5 is not allowed')

// run the program with streaming enabled
const res = await gen.forward({ startNumber: 1 }, { stream: true })

// or run the program with end-to-end streaming
const generator = await gen.streamingForward(
  { startNumber: 1 },
  {
    stream: true,
  }
)
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
  'answerInPoints',
  (value: string) => {
    const re = /^\d+\./

    // split the value by lines, trim each line,
    // filter out empty lines and check if all lines match the regex
    return value
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .every((x) => re.test(x))
  },
  'Lines must start with a number and a dot. Eg: 1. This is a line.'
)

// run the program with streaming enabled
const res = await gen.forward(
  {
    question: 'Provide a list of optimizations to speedup LLM inference.',
  },
  { stream: true, debug: true }
)
```

### Field Processors

Field processors are a powerful way to process fields in a prompt. They are used
to process fields in a prompt before the prompt is sent to the LLM.

```typescript
const gen = new AxChainOfThought(
  ai,
  `startNumber:number -> next10Numbers:number[]`
)

const streamValue = false

const processorFunction = (value) => {
  return value.map((x) => x + 1)
}

// Add a field processor to the program
const processor = new AxFieldProcessor(
  gen,
  'next10Numbers',
  processorFunction,
  streamValue
)

const res = await gen.forward({ startNumber: 1 })
```

## Model Context Protocol (MCP)

Ax provides seamless integration with the Model Context Protocol (MCP), allowing
your agents to access external tools, and resources through a standardized
interface.

### Using AxMCPClient

The `AxMCPClient` allows you to connect to any MCP-compatible server and use its
capabilities within your Ax agents:

```typescript
import { AxMCPClient, AxMCPStdioTransport } from '@ax-llm/ax'

// Initialize an MCP client with a transport
const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
})

// Create the client with optional debug mode
const client = new AxMCPClient(transport, { debug: true })

// Initialize the connection
await client.init()

// Use the client's functions in an agent
const memoryAgent = new AxAgent({
  name: 'MemoryAssistant',
  description: 'An assistant with persistent memory',
  signature: 'input, userId -> response',
  functions: [client], // Pass the client as a function provider
})

// Or use the client with AxGen
const memoryGen = new AxGen('input, userId -> response', {
  functions: [client],
})
```

### Using AxMCPClient with a Remote Server

Calling a remote MCP server with Ax is straightforward. For example, here's how you can use the DeepWiki MCP server to ask questions about nearly any public GitHub repository. The DeepWiki MCP server is available at `https://mcp.deepwiki.com/mcp`.

```typescript
import {
  AxAgent,
  AxAI,
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPStreambleHTTPTransport,
} from '@ax-llm/ax'

// 1. Initialize the MCP transport to the DeepWiki server
const transport = new AxMCPStreambleHTTPTransport(
  'https://mcp.deepwiki.com/mcp'
)

// 2. Create the MCP client
const mcpClient = new AxMCPClient(transport, { debug: false })
await mcpClient.init() // Initialize the connection

// 3. Initialize your AI model (e.g., OpenAI)
// Ensure your OPENAI_APIKEY environment variable is set
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

// 4. Create an AxAgent that uses the MCP client
const deepwikiAgent = new AxAgent<
  {
    // Define input types for clarity, matching a potential DeepWiki function
    questionAboutRepo: string
    githubRepositoryUrl: string
  },
  {
    answer: string
  }
>({
  name: 'DeepWikiQueryAgent',
  description: 'Agent to query public GitHub repositories via DeepWiki MCP.',
  signature: 'questionAboutRepo, githubRepositoryUrl -> answer',
  functions: [mcpClient], // Provide the MCP client to the agent
})

// 5. Formulate a question and call the agent
const result = await deepwikiAgent.forward(ai, {
  questionAboutRepo: 'What is the main purpose of this library?',
  githubRepositoryUrl: 'https://github.com/dosco/ax', // Example: Ax library itself
})
console.log('DeepWiki Answer:', result.answer)
```

This example shows how to connect to a public MCP server and use it within an Ax agent. The agent's signature (`questionAboutRepo, githubRepositoryUrl -> answer`) is an assumption of how one might interact with the DeepWiki service; you would typically discover the available functions and their signatures from the MCP server itself (e.g., via an `mcp.getFunctions` call if supported, or documentation).

For a more complex example involving authentication and custom headers with a remote MCP server, please refer to the `src/examples/mcp-client-pipedream.ts` file in this repository.

## AI Routing and Load Balancing

Ax provides two powerful ways to work with multiple AI services: a load balancer
for high availability and a router for model-specific routing.

### Load Balancer

The load balancer automatically distributes requests across multiple AI services
based on performance and availability. If one service fails, it automatically
fails over to the next available service.

```typescript
import { AxAI, AxBalancer } from '@ax-llm/ax'

// Setup multiple AI services
const openai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY,
})

const ollama = new AxAI({
  name: 'ollama',
  config: { model: 'nous-hermes2' },
})

const gemini = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY,
})

// Create a load balancer with all services
const balancer = new AxBalancer([openai, ollama, gemini])

// Use like a regular AI service - automatically uses the best available service
const response = await balancer.chat({
  chatPrompt: [{ role: 'user', content: 'Hello!' }],
})

// Or use the balance with AxGen
const gen = new AxGen(`question -> answer`)
const res = await gen.forward(balancer, { question: 'Hello!' })
```

### Multi-Service Router

The router lets you use multiple AI services through a single interface,
automatically routing requests to the right service based on the model
specified.

```typescript
import { AxAI, AxAIOpenAIModel, AxMultiServiceRouter } from '@ax-llm/ax'

// Setup OpenAI with model list
const openai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY,
  models: [
    {
      key: 'basic',
      model: AxAIOpenAIModel.GPT4OMini,
      description:
        'Model for very simple tasks such as answering quick short questions',
    },
    {
      key: 'medium',
      model: AxAIOpenAIModel.GPT4O,
      description:
        'Model for semi-complex tasks such as summarizing text, writing code, and more',
    },
  ],
})

// Setup Gemini with model list
const gemini = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY,
  models: [
    {
      key: 'deep-thinker',
      model: 'gemini-2.0-flash-thinking',
      description:
        'Model that can think deeply about a task, best for tasks that require planning',
    },
    {
      key: 'expert',
      model: 'gemini-2.0-pro',
      description:
        'Model that is the best for very complex tasks such as writing large essays, complex coding, and more',
    },
  ],
})

const ollama = new AxAI({
  name: 'ollama',
  config: { model: 'nous-hermes2' },
})

const secretService = {
  key: 'sensitive-secret',
  service: ollama,
  description: 'Model for sensitive secrets tasks',
}

// Create a router with all services
const router = new AxMultiServiceRouter([openai, gemini, secretService])

// Route to OpenAI's expert model
const openaiResponse = await router.chat({
  chatPrompt: [{ role: 'user', content: 'Hello!' }],
  model: 'expert',
})

// Or use the router with AxGen
const gen = new AxGen(`question -> answer`)
const res = await gen.forward(router, { question: 'Hello!' })
```

The load balancer is ideal for high availability while the router is perfect
when you need specific models for specific tasks Both can be used with any of
Ax's features like streaming, function calling, and chain-of-thought prompting.

You can also use the balancer and the router together either the multiple
balancers can be used with the router or the router can be used with the
balancer.

## OpenTelemetry support

The ability to trace and observe your llm workflow is critical to building
production workflows. OpenTelemetry is an industry-standard, and we support the
new `gen_ai` attribute namespace. Checkout `src/examples/telemetry.ts` for more
information.

```typescript
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'

const provider = new BasicTracerProvider()
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
trace.setGlobalTracerProvider(provider)

const tracer = trace.getTracer('test')

const ai = new AxAI({
  name: 'ollama',
  config: { model: 'nous-hermes2' },
  options: { tracer },
})

const gen = new AxChainOfThought(
  ai,
  `text -> shortSummary "summarize in 5 to 10 words"`
)

const res = await gen.forward({ text })
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

## Tuning the prompts (Basic)

You can tune your prompts using a larger model to help them run more efficiently
and give you better results. This is done by using an optimizer like
`AxBootstrapFewShot` with and examples from the popular `HotPotQA` dataset. The
optimizer generates demonstrations `demos` which when used with the prompt help
improve its efficiency.

```typescript
// Download the HotPotQA dataset from huggingface
const hf = new AxHFDataLoader({
  dataset: 'hotpot_qa',
  split: 'train',
})

const examples = await hf.getData<{ question: string; answer: string }>({
  count: 100,
  fields: ['question', 'answer'],
})

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

// Setup the program to tune
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`
)

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new AxBootstrapFewShot<
  { question: string },
  { answer: string }
>({
  program,
  examples,
})

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) =>
  emScore(prediction.answer as string, example.answer as string)

// Run the optimizer and remember to save the result to use later
const result = await optimize.compile(metricFn);

// Save the generated demos to a file
// import fs from 'fs'; // Ensure fs is imported in your actual script
fs.writeFileSync('bootstrap-demos.json', JSON.stringify(result.demos, null, 2));
console.log('Demos saved to bootstrap-demos.json');
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
import { AxAI, AxChainOfThought, AxMiPRO } from '@ax-llm/ax'

// 1. Setup your AI service
const ai = new AxAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY,
})

// 2. Create your program
const program = new AxChainOfThought(`input -> output`)

// 3. Configure the optimizer
const optimizer = new AxMiPRO({
  ai,
  program,
  examples: trainingData, // Your training examples
  options: {
    numTrials: 20, // Number of configurations to try
    auto: 'medium', // Optimization level
  },
})

// 4. Define your evaluation metric
const metricFn = ({ prediction, example }) => {
  return prediction.output === example.output
}

// 5. Run the optimization
const optimizedProgram = await optimizer.compile(metricFn, {
  valset: validationData, // Optional validation set
})

// 6. Use the optimized program
const result = await optimizedProgram.forward(ai, { input: 'test input' })
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
| abort-patterns.ts | Example on how to abort requests |

### Optimization Levels

You can quickly configure optimization intensity with the `auto` parameter:

```typescript
// Light optimization (faster, less thorough)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'light' })

// Medium optimization (balanced)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'medium' })

// Heavy optimization (slower, more thorough)
const optimizedProgram = await optimizer.compile(metricFn, { auto: 'heavy' })
```

### Advanced Example: Sentiment Analysis

```typescript
// Create sentiment analysis program
const classifyProgram = new AxChainOfThought<
  { productReview: string },
  { label: string }
>(`productReview -> label:string "positive" or "negative"`)

// Configure optimizer with advanced settings
const optimizer = new AxMiPRO({
  ai,
  program: classifyProgram,
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
})

// Run optimization and save the result
const optimizedProgram = await optimizer.compile(metricFn, {
  valset: validationData,
})

// Save configuration for future use
const programConfig = JSON.stringify(optimizedProgram, null, 2);
await fs.promises.writeFile("./optimized-config.json", programConfig);
console.log('> Done. Optimized program config saved to optimized-config.json');
```

## Using the Tuned Prompts

Both the basic Bootstrap Few Shot optimizer and the advanced MiPRO v2 optimizer generate **demos** (demonstrations) that significantly improve your program's performance. These demos are examples that show the LLM how to properly handle similar tasks.

### What are Demos?

Demos are input-output examples that get automatically included in your prompts to guide the LLM. They act as few-shot learning examples, showing the model the expected behavior for your specific task.

### Loading and Using Demos

Whether you used Bootstrap Few Shot or MiPRO v2, the process of using the generated demos is the same:

```typescript
import fs from 'fs'
import { AxAI, AxGen, AxChainOfThought } from '@ax-llm/ax'

// 1. Setup your AI service
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY,
})

// 2. Create your program (same signature as used during tuning)
const program = new AxChainOfThought(`question -> answer "in short 2 or 3 words"`)

// 3. Load the demos from the saved file
const demos = JSON.parse(fs.readFileSync('bootstrap-demos.json', 'utf8'))

// 4. Apply the demos to your program
program.setDemos(demos)

// 5. Use your enhanced program
const result = await program.forward(ai, {
  question: 'What castle did David Gregory inherit?'
})

console.log(result) // Now performs better with the learned examples
```

### Simple Example: Text Classification

Here's a complete example showing how demos improve a classification task:

```typescript
// Create a classification program
const classifier = new AxGen(`text -> category:class "positive, negative, neutral"`)

// Load demos generated from either Bootstrap or MiPRO tuning
const savedDemos = JSON.parse(fs.readFileSync('classification-demos.json', 'utf8'))
classifier.setDemos(savedDemos)

// Now the classifier has learned from examples and performs better
const result = await classifier.forward(ai, {
  text: "This product exceeded my expectations!"
})

console.log(result.category) // More accurate classification
```

### Key Benefits of Using Demos

- **Improved Accuracy**: Programs perform significantly better with relevant examples
- **Consistent Output**: Demos help maintain consistent response formats
- **Reduced Hallucination**: Examples guide the model toward expected behaviors
- **Cost Effective**: Better results without needing larger/more expensive models

### Best Practices

1. **Save Your Demos**: Always save generated demos to files for reuse
2. **Match Signatures**: Use the exact same signature when loading demos
3. **Version Control**: Keep demo files in version control for reproducibility
4. **Regular Updates**: Re-tune periodically with new data to improve demos

Both Bootstrap Few Shot and MiPRO v2 generate demos in the same format, so you can use this same loading pattern regardless of which optimizer you used for tuning.

## Built-in Functions

| Function           | Name               | Description                                  |
| ------------------ | ------------------ | -------------------------------------------- |
| JS Interpreter     | AxJSInterpreter    | Execute JS code in a sandboxed env           |
| Docker Sandbox     | AxDockerSession    | Execute commands within a docker environment |
| Embeddings Adapter | AxEmbeddingAdapter | Fetch and pass embedding to your function    |

## Check out all the examples

Use the `tsx` command to run the examples. It makes the node run typescript
code. It also supports using an `.env` file to pass the AI API Keys instead of
putting them in the command line.

```shell
OPENAI_APIKEY=api-key npm run tsx ./src/examples/marketing.ts
```

| Example                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| [customer-support.ts](https://github.com/ax-llm/ax/blob/main/src/examples/customer-support.ts)     | Extract valuable details from customer communications   |
| [debug-logging.ts](https://github.com/ax-llm/ax/blob/main/src/examples/debug-logging.ts)        | Debug and custom logging examples with different loggers |
| [function.ts](https://github.com/ax-llm/ax/blob/main/src/examples/function.ts)             | Simple single function calling example                  |
| [food-search.ts](https://github.com/ax-llm/ax/blob/main/src/examples/food-search.ts)          | Multi-step, multi-function calling example              |
| [marketing.ts](https://github.com/ax-llm/ax/blob/main/src/examples/marketing.ts)            | Generate short effective marketing sms messages         |
| [vectordb.ts](https://github.com/ax-llm/ax/blob/main/src/examples/vectordb.ts)             | Chunk, embed and search text                            |
| [fibonacci.ts](https://github.com/ax-llm/ax/blob/main/src/examples/fibonacci.ts)            | Use the JS code interpreter to compute fibonacci        |
| [summarize.ts](https://github.com/ax-llm/ax/blob/main/src/examples/summarize.ts)            | Generate a short summary of a large block of text       |
| [chain-of-thought.ts](https://github.com/ax-llm/ax/blob/main/src/examples/chain-of-thought.ts)     | Use chain-of-thought prompting to answer questions      |
| [rag.ts](https://github.com/ax-llm/ax/blob/main/src/examples/rag.ts)                  | Use multi-hop retrieval to answer questions             |
| [rag-docs.ts](https://github.com/ax-llm/ax/blob/main/src/examples/rag-docs.ts)             | Convert PDF to text and embed for rag search            |
| [react.ts](https://github.com/ax-llm/ax/blob/main/src/examples/react.ts)                | Use function calling and reasoning to answer questions  |
| [agent.ts](https://github.com/ax-llm/ax/blob/main/src/examples/agent.ts)                | Agent framework, agents can use other agents, tools etc |
| [streaming1.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming1.ts)           | Output fields validation while streaming                |
| [streaming2.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming2.ts)           | Per output field validation while streaming             |
| [streaming3.ts](https://github.com/ax-llm/ax/blob/main/src/examples/streaming3.ts)           | End-to-end streaming example `streamingForward()`       |
| [smart-hone.ts](https://github.com/ax-llm/ax/blob/main/src/examples/smart-hone.ts)           | Agent looks for dog in smart home                       |
| [multi-modal.ts](https://github.com/ax-llm/ax/blob/main/src/examples/multi-modal.ts)          | Use an image input along with other text inputs         |
| [balancer.ts](https://github.com/ax-llm/ax/blob/main/src/examples/balancer.ts)             | Balance between various llm's based on cost, etc        |
| [docker.ts](https://github.com/ax-llm/ax/blob/main/src/examples/docker.ts)               | Use the docker sandbox to find files by description     |
| [prime.ts](https://github.com/ax-llm/ax/blob/main/src/examples/prime.ts)                | Using field processors to process fields in a prompt    |
| [simple-classify.ts](https://github.com/ax-llm/ax/blob/main/src/examples/simple-classify.ts)      | Use a simple classifier to classify stuff               |
| [mcp-client-memory.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-memory.ts)    | Example of using an MCP server for memory with Ax       |
| [mcp-client-blender.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-blender.ts)   | Example of using an MCP server for Blender with Ax      |
| [mcp-client-pipedream.ts](https://github.com/ax-llm/ax/blob/main/src/examples/mcp-client-pipedream.ts) | Example of integrating with a remote MCP                |
| [tune-bootstrap.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-bootstrap.ts)       | Use bootstrap optimizer to improve prompt efficiency    |
| [tune-mipro.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-mipro.ts)           | Use mipro v2 optimizer to improve prompt efficiency     |
| [tune-usage.ts](https://github.com/ax-llm/ax/blob/main/src/examples/tune-usage.ts)           | Use the optimized tuned prompts                         |
| [telemetry.ts](https://github.com/ax-llm/ax/blob/main/src/examples/telemetry.ts)            | Trace and push traces to a Jaeger service               |
| [openai-responses.ts](https://github.com/ax-llm/ax/blob/main/src/examples/openai-responses.ts)     | Example using the new OpenAI Responses API              |
| [show-thoughts.ts](https://github.com/ax-llm/ax/blob/main/src/examples/show-thoughts.ts)       | Control and display model reasoning thoughts             |
| [use-examples.ts](https://github.com/ax-llm/ax/blob/main/src/examples/use-examples.ts) | Example of using 'examples' to direct the llm |

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
const ai = new AxOpenAI({ apiKey: process.env.OPENAI_APIKEY } as AxOpenAIArgs)
```

### 2. Create a prompt signature based on your usecase

```ts
// Signature defines the inputs and outputs of your prompt program
const cot = new ChainOfThought(ai, `question:string -> answer:string`, { mem })
```

### 3. Execute this new prompt program

```ts
// Pass in the input fields defined in the above signature
const res = await cot.forward({ question: 'Are we in a simulation?' })
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
    name: 'getCurrentWeather',
    description: 'get the current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'location to get weather for',
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          default: 'imperial',
          description: 'units to use',
        },
      },
      required: ['location'],
    },
    func: async (args: Readonly<{ location: string; units: string }>) => {
      return `The weather in ${args.location} is 72 degrees`
    },
  },
]
```

### 2. Pass the functions to a prompt

```ts
const cot = new AxGen(ai, `question:string -> answer:string`, { functions })
```

## Enable debug logs

```ts
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY,
} as AxOpenAIArgs)
ai.setOptions({ debug: true })
```

## Custom Logger

You can provide a custom logger function to control how debug information and other messages are output. This is useful for integrating with logging frameworks or customizing the output format.

```ts
// Custom logger that prefixes messages with timestamp
const customLogger = (message: string) => {
  const timestamp = new Date().toISOString()
  process.stdout.write(`[${timestamp}] ${message}`)
}

// Set logger on AI service
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY,
  options: {
    debug: true,
    logger: customLogger
  }
})

// Or set logger on generation programs
const gen = new AxGen(
  'question -> answer:string',
  { logger: customLogger }
)

// Logger can also be passed through options
const result = await gen.forward(ai, { question: 'Hello' }, {
  logger: customLogger
})
```

The logger function receives a string message and is responsible for outputting it. If no logger is provided, messages are written to `process.stdout.write` by default.

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
const apiKey = process.env.OPENAI_APIKEY
const conf = AxOpenAIBestConfig()
const ai = new AxOpenAI({ apiKey, conf } as AxOpenAIArgs)
```

## 3. My prompt is too long / can I change the max tokens?

```ts
const conf = axOpenAIDefaultConfig() // or OpenAIBestOptions()
conf.maxTokens = 2000
```

## 4. How do I change the model? (e.g., I want to use GPT4)

```ts
const conf = axOpenAIDefaultConfig() // or OpenAIBestOptions()
conf.model = OpenAIModel.GPT4Turbo
```

## Monorepo tips & tricks

It is essential to remember that we should only run `npm install` from the root
directory. This prevents the creation of nested `package-lock.json` files and
avoids non-deduplicated `node_modules`.

[![Ask DeepWiki](https://deepwiki.com/badge.svg?style=for-the-badge)](https://deepwiki.com/ax-llm/ax)

Adding new dependencies in packages should be done with e.g.
`npm install lodash --workspace=ax` (or just modify the appropriate
`package.json` and run `npm install` from root).
