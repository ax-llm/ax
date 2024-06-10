# LLMClient - Typescript/JS Library to build with LLMs

JS/TS library to make to easy to build with LLMs. Full support for various LLMs and VectorDBs, Agents, Function Calling, Chain-of-Thought, RAG, Semantic Router and more. Based on the popular Stanford DSP paper. Create and compose efficient prompts using prompt signatures. 🌵 🦙 🔥 ❤️ 🖖🏼

[![NPM Package](https://img.shields.io/npm/v/llmclient?style=for-the-badge&color=green)](https://www.npmjs.com/package/llmclient)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://dcbadge.vercel.app/api/server/DSHg3dU7dW?style=for-the-badge)](https://discord.gg/DSHg3dU7dW)

![llama-small](https://github.com/dosco/llm-client/assets/832235/b959fdd6-c723-49b1-9fb9-bf879e75c147)

## Build with prompt signatures

LLMClient is an easy to use library build around "Prompt Signatures" from the `Stanford DSP` paper. This library will automatically generate efficient and typed prompts from prompt signatures like `question:string -> answer:string`.

Build powerful workflows using components like RAG, ReAcT, Chain of Thought, Function calling, Agents, etc all built on prompt signatures and easy to compose together to build whatever you want. Using prompt signatures automatically gives you the ability to fine tune your prompt programs using optimizers. Tune with a larger model and have your program run efficiently on a smaller model. The tuning here is not the traditional model tuning but what we call prompt tuning.

## Why use LLMClient?

- Support for various LLMs and Vector DBs
- Prompts auto-generated from simple signatures
- Multi-Hop RAG, ReAcT, CoT, Function Calling and more
- Build Agents that can call other agents
- Convert docs of any format to text
- RAG, smart chunking, embedding, querying
- Output field processing while streaming
- Automatic prompt tuning using optimizers
- OpenTelemetry tracing / observability
- Production ready Typescript code
- Lite weight, zero-dependencies

## Whats a prompt signature?

<img width="860" alt="shapes at 24-03-31 00 05 55" src="https://github.com/dosco/llm-client/assets/832235/0f0306ea-1812-4a0a-9ed5-76cd908cd26b">

Efficient type-safe prompts are auto-generated from a simple signature. A prompt signature is made of a `"task description" inputField:type "field description" -> outputField:type"`. The idea behind prompt signatures is based off work done in the "Demonstrate-Search-Predict" paper.

You can have multiple input and output fields and each field has one of these types `string`, `number`, `boolean`, `json` or a array of any of these eg. `string[]`. When a type is not defined it defaults to `string`. When the `json` type if used the underlying AI is encouraged to generate correct JSON.

## LLM's Supported

| Provider      | Best Models             | Tested  |
| ------------- | ----------------------- | ------- |
| OpenAI        | GPT: 4o, 4T, 4, 3.5     | 🟢 100% |
| Azure OpenAI  | GPT: 4, 4T, 3.5         | 🟢 100% |
| Together      | Several OSS Models      | 🟢 100% |
| Cohere        | CommandR, Command       | 🟢 100% |
| Anthropic     | Claude 2, Claude 3      | 🟢 100% |
| Mistral       | 7B, 8x7B, S, M & L      | 🟢 100% |
| Groq          | Lama2-70B, Mixtral-8x7b | 🟢 100% |
| DeepSeek      | Chat and Code           | 🟢 100% |
| Ollama        | All models              | 🟢 100% |
| Google Gemini | Gemini: Flash, Pro      | 🟢 100% |
| Hugging Face  | OSS Model               | 🟡 50%  |

## Install

```bash
npm install llmclient
# or
yarn add llmclient
```

## Example: Using chain-of-thought to summarize text

```typescript
import { AI, ChainOfThought, OpenAIArgs } from 'llmclient';

const textToSummarize = `
The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] ...`;

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const gen = new ChainOfThought(
  ai,
  `textToSummarize -> shortSummary "summarize in 5 to 10 words"`
);
const res = await gen.forward({ textToSummarize });

console.log('>', res);
```

## Example: Building an agent

Use the agent prompt (framework) to build agents that work with other agents to complete tasks. Agents are easy to build with prompt signatures. Try out the agent example.

```typescript
# npm run tsx ./src/examples/agent.ts

const researcher = new Agent(ai, {
  name: 'researcher',
  description: 'Researcher agent',
  signature: `physicsQuestion "physics questions" -> answer "reply in bullet points"`
});

const summarizer = new Agent(ai, {
  name: 'summarizer',
  description: 'Summarizer agent',
  signature: `text "text so summarize" -> shortSummary "summarize in 5 to 10 words"`
});

const agent = new Agent(ai, {
  name: 'agent',
  description: 'A an agent to research complex topics',
  signature: `question -> answer`,
  agents: [researcher, summarizer]
});

agent.forward({ questions: "How many atoms are there in the universe" })
```

## Fast LLM Router

A special router that uses no LLM calls only embeddings to route user requests smartly.

Use the Router to efficiently route user queries to specific routes designed to handle certain types of questions or tasks. Each route is tailored to a particular domain or service area. Instead of using a slow or expensive LLM to decide how input from the user should be handled use our fast "Semantic Router" that uses inexpensive and fast embedding queries.

```typescript
# npm run tsx ./src/examples/routing.ts

const customerSupport = new Route('customerSupport', [
  'how can I return a product?',
  'where is my order?',
  'can you help me with a refund?',
  'I need to update my shipping address',
  'my product arrived damaged, what should I do?'
]);

const technicalSupport = new Route('technicalSupport', [
  'how do I install your software?',
  'I’m having trouble logging in',
  'can you help me configure my settings?',
  'my application keeps crashing',
  'how do I update to the latest version?'
]);

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

const router = new Router(ai);
await router.setRoutes(
  [customerSupport, technicalSupport],
  { filename: 'router.json' }
);

const tag = await router.forward('I need help with my order');

if (tag === "customerSupport") {
    ...
}
if (tag === "technicalSupport") {
    ...
}
```

## Vector DBs Supported

Vector databases are critical to building LLM workflows. We have clean abstractions over popular vector db's as well as our own quick in memory vector database.

| Provider   | Tested  |
| ---------- | ------- |
| In Memory  | 🟢 100% |
| Weaviate   | 🟢 100% |
| Cloudflare | 🟡 50%  |
| Pinecone   | 🟡 50%  |

```typescript
// Create embeddings from text using an LLM
const ret = await this.ai.embed({ texts: 'hello world' });

// Create an in memory vector db
const db = new DB('memory');

// Insert into vector db
await this.db.upsert({
  id: 'abc',
  table: 'products',
  values: ret.embeddings[0]
});

// Query for similar entries using embeddings
const matches = await this.db.query({
  table: 'products',
  values: embeddings[0]
});
```

Alternatively you can use the `DBManager` which handles smart chunking, embedding and querying everything
for you, it makes things almost too easy.

```typescript
const manager = new DBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query(
  'John von Neumann on human intelligence and singularity.'
);
console.log(matches);
```

## RAG Documents

Using documents like PDF, DOCX, PPT, XLS, etc with LLMs is a huge pain. We make it easy with the help of Apache Tika an open source document processing engine.

Launch Apache Tika

```shell
docker run -p 9998:9998 apache/tika
```

Convert documents to text and embed them for retrieval using the `DBManager` it also supports a reranker and query rewriter. Two default implementations `DefaultResultReranker` and `DefaultQueryRewriter` are available to use.

```typescript
const tika = new ApacheTika();
const text = await tika.convert('/path/to/document.pdf');

const manager = new DBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query('Find some text');
console.log(matches);
```

## Streaming

We support parsing output fields and function execution while streaming. This allows for fail-fast and error correction without having to wait for the whole output saving tokens, cost and reducing latency. Assertions are a powerful way to ensure the output matches your requirements these work with streaming as well.

```typescript
// setup the prompt program
const gen = new ChainOfThought(
  ai, `startNumber:number -> next10Numbers:number[]`
);

// add a assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined;
}, 'Numbers 5 is not allowed');

// run the program with streaming enabled
const res = await gen.forward(
  { startNumber: 1 },
  { stream: true }
);
```

## OpenTelemetry support

Ability to trace and observe your llm workflow is critical to building production workflows. OpenTelemetry is an industry standard and we support the new `gen_ai` attribute namespace.
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

const ai = AI("ollama", {
  model: "nous-hermes2",
  options: { tracer },
} as unknown as OllamaArgs);

const gen = new ChainOfThought(
  ai,
  `text -> shortSummary "summarize in 5 to 10 words"`
);

const res = await gen.forward({ text });
````

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

Alternatively you can use the `DBManager` which handles smart chunking, embedding and querying everything
for you, it makes things almost too easy.

```typescript
const manager = new DBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query(
  'John von Neumann on human intelligence and singularity.'
);
console.log(matches);
```

## Tuning the prompts (programs)

You can tune your prompts using a larger model to help them run more efficiently and give you better results. This is done by using an optimizer like `BootstrapFewShot` with and examples from the popular `HotPotQA` dataset. The optimizer generates demonstrations `demos` which when used with the prompt help improve its efficiency.

```typescript
// Download the HotPotQA dataset from huggingface
const hf = new HFDataLoader();
const examples = await hf.getData<{ question: string; answer: string }>({
  dataset: 'hotpot_qa',
  split: 'train',
  count: 100,
  fields: ['question', 'answer']
});

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

// Setup the program to tune
const program = new ChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`
);

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new BootstrapFewShot<{ question: string }, { answer: string }>(
  {
    program,
    examples
  }
);

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: MetricFn = ({ prediction, example }) =>
  emScore(prediction.answer as string, example.answer as string);

// Run the optimizer and save the result
await optimize.compile(metricFn, { filename: 'demos.json' });
```

<img width="853" alt="tune-prompt" src="https://github.com/dosco/llm-client/assets/832235/f924baa7-8922-424c-9c2c-f8b2018d8d74">

And to use the generated demos with the above `ChainOfThought` program

```typescript
const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

// Setup the program to use the tuned data
const program = new ChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`
);

// load tuning data
program.loadDemos('demos.json');

const res = await program.forward({
  question: 'What castle did David Gregory inherit?'
});

console.log(res);
```

## Checkout more examples

Use the `tsx` command to run the examples it makes node run typescript code. It also support using a `.env` file to pass the AI API Keys as opposed to putting them in the commandline.

```shell
OPENAI_APIKEY=openai_key npm run tsx ./src/examples/marketing.ts
```

| Example             | Description                                             |
| ------------------- | ------------------------------------------------------- |
| customer-support.ts | Extract valuable details from customer communications   |
| food-search.ts      | Use multiple APIs are used to find dinning options      |
| marketing.ts        | Generate short effective marketing sms messages         |
| vectordb.ts         | Chunk, embed and search text                            |
| fibonacci.ts        | Use the JS code interpreter to compute fibonacci        |
| summarize.ts        | Generate a short summary of a large block of text       |
| chain-of-thought.ts | Use chain-of-thought prompting to answer questions      |
| rag.ts              | Use multi-hop retrieval to answer questions             |
| rag-docs.ts         | Convert PDF to text and embed for rag search            |
| react.ts            | Use function calling and reasoning to answer questions  |
| agent.ts            | Agent framework, agents can use other agents, tools etc |
| qna-tune.ts         | Use an optimizer to improve prompt efficiency           |
| qna-use-tuned.ts    | Use the optimized tuned prompts                         |
| streaming.ts        | Assertions and output processing while streaming        |


## Built-in Functions

| Function           | Description                                            |
| ------------------ | ------------------------------------------------------ |
| Code Interpreter   | Used by the LLM to execute JS code in a sandboxed env. |
| Embeddings Adapter | Wrapper to fetch and pass embedding to your function   |

## Our Goal

Large language models (LLMs) are getting really powerful and have reached a point where they can work as the backend for your entire product. However there's still a lot of complexity to manage from using the right prompts, models, streaming, function calling, error-correction, and much more. Our goal is to package all this complexity into a well maintained easy to use library that can work with all the LLMs out there. Additionally we are using the latest research to add useful new capabilities like DSP to the library.

## How to use this library?

### 1. Pick an AI to work with

```ts
// Pick a LLM
const ai = new OpenAI({ apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
```

### 2. Create a prompt signature based on your usecase

```ts
// Signature defines the inputs and outputs of your prompt program
const cot = new ChainOfThought(ai, `question:string -> answer:string`, { mem });
```

### 3. Execute this new prompt program

```ts
// Pass in the input fields defined in the above signature
const res = await cot.forward({ question: 'Are we in a simulation?' });
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
          description: 'location to get weather for'
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          default: 'imperial',
          description: 'units to use'
        }
      },
      required: ['location']
    },
    func: async (args: Readonly<{ location: string; units: string }>) => {
      return `The weather in ${args.location} is 72 degrees`;
    }
  }
];
```

### 2. Pass the functions to a prompt

```ts
const cot = new ReAct(ai, `question:string -> answer:string`, { functions });
```

## Enable debug logs

```ts
const ai = new OpenAI({ apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
ai.setOptions({ debug: true });
```

## Reach out

We're happy to help reach out if you have questions or join the Discord
[twitter/dosco](https://twitter.com/dosco)

## FAQ

### 1. The LLM can't find the right function to use

Improve the function naming and description be very clear on what the function does. Also ensure the function parameter's also have good descriptions. The descriptions don't have to be very long but need to be clear.

### 2. How do I change the configuration of the LLM used

You can pass a configuration object as the second parameter when creating a new LLM object

```ts
const apiKey = process.env.OPENAI_APIKEY;
const conf = OpenAIBestConfig();
const ai = new OpenAI({ apiKey, conf } as OpenAIArgs);
```

## 3. My prompt is too long and can I change the max tokens

```ts
const conf = OpenAIDefaultConfig(); // or OpenAIBestOptions()
conf.maxTokens = 2000;
```

## 4. How do I change the model say I want to use GPT4

```ts
const conf = OpenAIDefaultConfig(); // or OpenAIBestOptions()
conf.model = OpenAIModel.GPT4Turbo;
```
