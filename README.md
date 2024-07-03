# Ax - Build LLMs Powered Agents (Typescript)

Build intelligent agents with ease, inspired by the power of "Agentic workflows" and the Stanford DSP paper. Seamlessly integrates with multiple LLMs and VectorDBs to build RAG pipelines or collaborative agents that can solve complex problems. Advanced features streaming validation, multi-modal DSP, etc.

[![NPM Package](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=green)](https://www.npmjs.com/package/@ax-llm/ax)
[![Discord Chat](https://dcbadge.vercel.app/api/server/DSHg3dU7dW?style=for-the-badge)](https://discord.gg/DSHg3dU7dW)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)

![image](https://github.com/ax-llm/ax/assets/832235/3a250031-591c-42e0-b4fc-06afb8c351c4)

## Our focus on agents

We've renamed from "llmclient" to "ax" to highlight our focus on powering agentic workflows. We agree with many experts like "Andrew Ng" that agentic workflows are the key to unlocking the true power of large language models and what can be achieved with in-context learning. Also we are big fans of the Stanford DSP paper and this library is the result of all of this coming together to build a powerful framework for you to build with.

![image](https://github.com/ax-llm/ax/assets/832235/801b8110-4cba-4c50-8ec7-4d5859121fe5)

## Why use Ax?

- Support for various LLMs and Vector DBs
- Prompts auto-generated from simple signatures
- Build Agents that can call other agents
- Convert docs of any format to text
- RAG, smart chunking, embedding, querying
- Output validation while streaming
- Multi-modal DSP supported
- Automatic prompt tuning using optimizers
- OpenTelemetry tracing / observability
- Production ready Typescript code
- Lite weight, zero-dependencies

## Whats a prompt signature?

<img width="860" alt="shapes at 24-03-31 00 05 55" src="https://github.com/dosco/llm-client/assets/832235/0f0306ea-1812-4a0a-9ed5-76cd908cd26b">

Efficient type-safe prompts are auto-generated from a simple signature. A prompt signature is made up of a `"task description" inputField:type "field description" -> outputField:type"`. The idea behind prompt signatures is based off work done in the "Demonstrate-Search-Predict" paper.

You can have multiple input and output fields and each field has one of these types `string`, `number`, `boolean`, `json` or a array of any of these eg. `string[]`. When a type is not defined it defaults to `string`. When the `json` type if used the underlying AI is encouraged to generate correct JSON.

## LLMs Supported

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
npm install @ax-llm/ax
# or
yarn add @ax-llm/ax
```

## Example: Using chain-of-thought to summarize text

```typescript
import { AxAI, AxChainOfThought } from '@ax-llm/ax';

const textToSummarize = `
The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to human civilization.[2][3] ...`;

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

const gen = new AxChainOfThought(
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

const researcher = new AxAgent(ai, {
  name: 'researcher',
  description: 'Researcher agent',
  signature: `physicsQuestion "physics questions" -> answer "reply in bullet points"`
});

const summarizer = new AxAgent(ai, {
  name: 'summarizer',
  description: 'Summarizer agent',
  signature: `text "text so summarize" -> shortSummary "summarize in 5 to 10 words"`
});

const agent = new AxAgent(ai, {
  name: 'agent',
  description: 'A an agent to research complex topics',
  signature: `question -> answer`,
  agents: [researcher, summarizer]
});

agent.forward({ questions: "How many atoms are there in the universe" })
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
const db = new axDB('memory');

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

Alternatively you can use the `AxDBManager` which handles smart chunking, embedding and querying everything
for you, it makes things almost too easy.

```typescript
const manager = new AxDBManager({ ai, db });
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

Convert documents to text and embed them for retrieval using the `AxDBManager` it also supports a reranker and query rewriter. Two default implementations `AxDefaultResultReranker` and `AxDefaultQueryRewriter` are available to use.

```typescript
const tika = new AxApacheTika();
const text = await tika.convert('/path/to/document.pdf');

const manager = new AxDBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query('Find some text');
console.log(matches);
```

## Multi-modal DSP

When using models like `gpt-4o` and `gemini` that support multi-modal prompts we support using image fields and this works with the whole dsp pipeline.

```typescript
const image = fs
  .readFileSync('./src/examples/assets/kitten.jpeg')
  .toString('base64');

const gen = new AxChainOfThought(ai, `question, animalImage:image -> answer`);

const res = await gen.forward({
  question: 'What family does this animal belong to?',
  animalImage: { mimeType: 'image/jpeg', data: image }
});
```

## Streaming

We support parsing output fields and function execution while streaming. This allows for fail-fast and error correction without having to wait for the whole output saving tokens, cost and reducing latency. Assertions are a powerful way to ensure the output matches your requirements these work with streaming as well.

```typescript
// setup the prompt program
const gen = new AxChainOfThought(
  ai,
  `startNumber:number -> next10Numbers:number[]`
);

// add a assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined;
}, 'Numbers 5 is not allowed');

// run the program with streaming enabled
const res = await gen.forward({ startNumber: 1 }, { stream: true });
```

The above example will allow you to validate entire output fields as they are streamed in. This validation works with streaming and when not streaming and is triggered when the entire field value is available. For true validation while streaming checkout the below example. This will massively improve performance and save tokens at scale in production

```typescript
// add a assertion to ensure all lines start with a number and a dot.
gen.addStreamingAssert(
  'answerInPoints',
  (value: string) => {
    const re = /^\d+\./;

    // split the value by lines, trim each line,
    // filter out empty lines and check if all lines match the regex
    return value
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .every((x) => re.test(x));
  },
  'Lines must start with a number and a dot. Eg: 1. This is a line.'
);

// run the program with streaming enabled
const res = await gen.forward(
  {
    question: 'Provide a list of optimizations to speedup LLM inference.'
  },
  { stream: true, debug: true }
);
```

## Fast LLM Router

A special router that uses no LLM calls only embeddings to route user requests smartly.

Use the Router to efficiently route user queries to specific routes designed to handle certain types of questions or tasks. Each route is tailored to a particular domain or service area. Instead of using a slow or expensive LLM to decide how input from the user should be handled use our fast "Semantic Router" that uses inexpensive and fast embedding queries.

```typescript
# npm run tsx ./src/examples/routing.ts

const customerSupport = new AxRoute('customerSupport', [
  'how can I return a product?',
  'where is my order?',
  'can you help me with a refund?',
  'I need to update my shipping address',
  'my product arrived damaged, what should I do?'
]);

const technicalSupport = new AxRoute('technicalSupport', [
  'how do I install your software?',
  'I’m having trouble logging in',
  'can you help me configure my settings?',
  'my application keeps crashing',
  'how do I update to the latest version?'
]);

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY as string });

const router = new AxRouter(ai);
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

## OpenTelemetry support

Ability to trace and observe your llm workflow is critical to building production workflows. OpenTelemetry is an industry standard and we support the new `gen_ai` attribute namespace.

```typescript
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base';

const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
trace.setGlobalTracerProvider(provider);

const tracer = trace.getTracer('test');

const ai = new AxAI({
  name: 'ollama',
  config: { model: 'nous-hermes2' },
  options: { tracer }
});

const gen = new AxChainOfThought(
  ai,
  `text -> shortSummary "summarize in 5 to 10 words"`
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

## Tuning the prompts (programs)

You can tune your prompts using a larger model to help them run more efficiently and give you better results. This is done by using an optimizer like `AxBootstrapFewShot` with and examples from the popular `HotPotQA` dataset. The optimizer generates demonstrations `demos` which when used with the prompt help improve its efficiency.

```typescript
// Download the HotPotQA dataset from huggingface
const hf = new AxHFDataLoader({
  dataset: 'hotpot_qa',
  split: 'train'
});

const examples = await hf.getData<{ question: string; answer: string }>({
  count: 100,
  fields: ['question', 'answer']
});

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

// Setup the program to tune
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`
);

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new AxBootstrapFewShot<
  { question: string },
  { answer: string }
>({
  program,
  examples
});

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) =>
  emScore(prediction.answer as string, example.answer as string);

// Run the optimizer and remember to save the result to use later
const result = await optimize.compile(metricFn);
```

<img width="853" alt="tune-prompt" src="https://github.com/dosco/llm-client/assets/832235/f924baa7-8922-424c-9c2c-f8b2018d8d74">

And to use the generated demos with the above `ChainOfThought` program

```typescript
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

// Setup the program to use the tuned data
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
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

## Checkout all the examples

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
| streaming1.ts       | Output fields validation while streaming                |
| streaming2.ts       | Per output field validation while streaming             |
| smart-hone.ts       | Agent looks for dog in smart home                       |
| multi-modal.ts      | Use an image input along with other text inputs         |
| balancer.ts         | Balance between various llm's based on cost, etc        |

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
const cot = new AxReAct(ai, `question:string -> answer:string`, { functions });
```

## Enable debug logs

```ts
const ai = new AxOpenAI({ apiKey: process.env.OPENAI_APIKEY } as AxOpenAIArgs);
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
const conf = AxOpenAIBestConfig();
const ai = new AxOpenAI({ apiKey, conf } as AxOpenAIArgs);
```

## 3. My prompt is too long and can I change the max tokens

```ts
const conf = axOpenAIDefaultConfig(); // or OpenAIBestOptions()
conf.maxTokens = 2000;
```

## 4. How do I change the model say I want to use GPT4

```ts
const conf = axOpenAIDefaultConfig(); // or OpenAIBestOptions()
conf.model = OpenAIModel.GPT4Turbo;
```

## Monorepo tops & tricks

It's important to remember that we should only run `npm install` from the root directory. This is to prevent the creation of nested `package-lock.json` files and to avoid non deduplicated `node_modules`.

Adding new dependencies in packages should be done with e.g. `npm install lodash --workspace=ax` (or just modify the appropriate `package.json` and run `npm install` from root).
