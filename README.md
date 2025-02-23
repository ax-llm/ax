# Ax - Build LLM-Powered Agents (Typescript)

Use Ax and get an end-to-end streaming, multi-modal DSPy framework with agents and typed signatures. Works with all LLMs. Ax is always streaming and handles parsing, validating, error-correcting and function calling all while streaming. Ax is easy, fast and lowers your token usage.

[![NPM Package](https://img.shields.io/npm/v/@ax-llm/ax?style=for-the-badge&color=green)](https://www.npmjs.com/package/@ax-llm/ax)
[![Discord Chat](https://dcbadge.vercel.app/api/server/DSHg3dU7dW?style=for-the-badge)](https://discord.gg/DSHg3dU7dW)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)

## Why use Ax?

- Support for all top LLMs
- Prompts auto-generated from simple signatures
- Full native end-to-end streaming
- Build Agents that can call other agents
- Convert docs of any format to text
- RAG, smart chunking, embedding, querying
- Works with Vercel AI SDK
- Output validation while streaming
- Multi-modal DSPy supported
- Automatic prompt tuning using optimizers
- OpenTelemetry tracing / observability
- Production ready Typescript code
- Lite weight, zero-dependencies

## What's a prompt signature?

<img width="860" alt="shapes at 24-03-31 00 05 55" src="https://github.com/dosco/llm-client/assets/832235/0f0306ea-1812-4a0a-9ed5-76cd908cd26b">

Efficient type-safe prompts are auto-generated from a simple signature. A prompt signature is made up of a `"task description" inputField:type "field description" -> "outputField:type`. The idea behind prompt signatures is based on work done in the "Demonstrate-Search-Predict" paper.

You can have multiple input and output fields, and each field can be of the types `string`, `number`, `boolean`, `date`, `datetime`, `class "class1, class2"`, `JSON`, or an array of any of these, e.g., `string[]`. When a type is not defined, it defaults to `string`. The suffix `?` makes the field optional (required by default) and `!` makes the field internal which is good for things like reasoning.

## Output Field Types

| Type                      | Description                       | Usage                      | Example Output                                     |
|---------------------------|-----------------------------------|----------------------------|----------------------------------------------------|
| `string`                  | A sequence of characters.         | `fullName:string`          | `"example"`                                        |
| `number`                  | A numerical value.                | `price:number`             | `42`                                               |
| `boolean`                 | A true or false value.            | `isEvent:boolean`          | `true`, `false`                                    |
| `date`                    | A date value.                     | `startDate:date`           | `"2023-10-01"`                                     |
| `datetime`                | A date and time value.            | `createdAt:datetime`       | `"2023-10-01T12:00:00Z"`                           |
| `class "class1,class2"`   | A classification of items.        | `category:class`           | `["class1", "class2", "class3"]`                   |
| `string[]`                | An array of strings.              | `tags:string[]`            | `["example1", "example2"]`                         |
| `number[]`                | An array of numbers.              | `scores:number[]`          | `[1, 2, 3]`                                        |
| `boolean[]`               | An array of boolean values.       | `permissions:boolean[]`    | `[true, false, true]`                              |
| `date[]`                  | An array of dates.                | `holidayDates:date[]`      | `["2023-10-01", "2023-10-02"]`                     |
| `datetime[]`              | An array of date and time values. | `logTimestamps:datetime[]` | `["2023-10-01T12:00:00Z", "2023-10-02T12:00:00Z"]` |
| `class[] "class1,class2"` | Multiple classes                  | `categories:class[]`       | `["class1", "class2", "class3"]`                   |
| `code "language"`         | A code block in a specific language | `code:code "python"`     | `print('Hello, world!')`                          |



## LLMs Supported

`Google Gemini`, `Google Vertex`, `OpenAI`, `Azure OpenAI`, `TogetherAI`, `Anthropic`, `Cohere`, `Mistral`, `Groq`, `DeepSeek`, `Ollama`, `Reka`, `Hugging Face`

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
  `textToSummarize -> textType:class "note, email, reminder", shortSummary "summarize in 5 to 10 words"`
);

const res = await gen.forward(ai, { textToSummarize });

console.log('>', res);
```

## Example: Building an agent

Use the agent prompt (framework) to build agents that work with other agents to complete tasks. Agents are easy to make with prompt signatures. Try out the agent example.

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

## Vector DBs Supported

Vector databases are critical to building LLM workflows. We have clean abstractions over popular vector databases and our own quick in-memory vector database.

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

Using documents like PDF, DOCX, PPT, XLS, etc., with LLMs is a huge pain. We make it easy with Apache Tika, an open-source document processing engine.

Launch Apache Tika

```shell
docker run -p 9998:9998 apache/tika
```

Convert documents to text and embed them for retrieval using the `AxDBManager`, which also supports a reranker and query rewriter. Two default implementations, `AxDefaultResultReranker` and `AxDefaultQueryRewriter`, are available.

```typescript
const tika = new AxApacheTika();
const text = await tika.convert('/path/to/document.pdf');

const manager = new AxDBManager({ ai, db });
await manager.insert(text);

const matches = await manager.query('Find some text');
console.log(matches);
```

## Multi-modal DSPy

When using models like `GPT-4o` and `Gemini` that support multi-modal prompts, we support using image fields, and this works with the whole DSP pipeline.

```typescript
const image = fs
  .readFileSync('./src/examples/assets/kitten.jpeg')
  .toString('base64');

const gen = new AxChainOfThought(`question, animalImage:image -> answer`);

const res = await gen.forward(ai, {
  question: 'What family does this animal belong to?',
  animalImage: { mimeType: 'image/jpeg', data: image }
});
```

When using models like `gpt-4o-audio-preview` that support multi-modal prompts with audio support, we support using audio fields, and this works with the whole DSP pipeline.

```typescript
const audio = fs
  .readFileSync('./src/examples/assets/comment.wav')
  .toString('base64');

const gen = new AxGen(`question, commentAudio:audio -> answer`);

const res = await gen.forward(ai, {
  question: 'What family does this animal belong to?',
  commentAudio: { format: 'wav', data: audio }
});
```

## Streaming

### Assertions

We support parsing output fields and function execution while streaming. This allows for fail-fast and error correction without waiting for the whole output, saving tokens and costs and reducing latency. Assertions are a powerful way to ensure the output matches your requirements; they also work with streaming.

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

// or run the program with end-to-end streaming
const generator = await gen.streamingForward({ startNumber: 1 }, { stream: true });
for await (const res of generator) {}
```

The above example allows you to validate entire output fields as they are streamed in. This validation works with streaming and when not streaming and is triggered when the whole field value is available. For true validation while streaming, check out the example below. This will massively improve performance and save tokens at scale in production.

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

### Field Processors

Field processors are a powerful way to process fields in a prompt. They are used to process fields in a prompt before the prompt is sent to the LLM.

```typescript
const gen = new AxChainOfThought(
  ai,
  `startNumber:number -> next10Numbers:number[]`
);  

const streamValue = false

const processorFunction = (value) => {
  return value.map((x) => x + 1);
}

// Add a field processor to the program     
const processor = new AxFieldProcessor(gen, 'next10Numbers', processorFunction, streamValue);

const res = await gen.forward({ startNumber: 1 });
```

## AI Routing and Load Balancing

Ax provides two powerful ways to work with multiple AI services: a load balancer for high availability and a router for model-specific routing.

### Load Balancer

The load balancer automatically distributes requests across multiple AI services based on performance and availability. If one service fails, it automatically fails over to the next available service.

```typescript
import { AxAI, AxBalancer } from '@ax-llm/ax'

// Setup multiple AI services
const openai = new AxAI({ 
  name: 'openai', 
  apiKey: process.env.OPENAI_APIKEY,
})

const ollama = new AxAI({ 
  name: 'ollama', 
  config: { model: "nous-hermes2" }
})

const gemini = new AxAI({ 
  name: 'google-gemini', 
  apiKey: process.env.GOOGLE_APIKEY 
})

// Create a load balancer with all services
const balancer = new AxBalancer([openai, ollama, gemini])

// Use like a regular AI service - automatically uses the best available service
const response = await balancer.chat({
  chatPrompt: [{ role: 'user', content: 'Hello!' }],
})

// Or use the balance with AxGen
const gen = new AxGen(`question -> answer`)
const res = await gen.forward(balancer,{ question: 'Hello!' })
```

### Multi-Service Router 

The router lets you use multiple AI services through a single interface, automatically routing requests to the right service based on the model specified.

```typescript
import { AxAI, AxMultiServiceRouter, AxAIOpenAIModel } from '@ax-llm/ax'

// Setup OpenAI with model list
const openai = new AxAI({ 
  name: 'openai', 
  apiKey: process.env.OPENAI_APIKEY,
  models: [
    {
      key: 'basic',
      model: AxAIOpenAIModel.GPT4OMini,
      description: 'Fast model for simple tasks',
    },
    {
      key: 'expert',
      model: AxAIOpenAIModel.GPT4O,
      description: 'Expert model for specialized tasks',
    }
  ]
})

// Setup Gemini with model list
const gemini = new AxAI({ 
  name: 'google-gemini', 
  apiKey: process.env.GOOGLE_APIKEY,
  models: [
    {
      key: 'basic',
      model: 'gemini-2.0-flash',
      description: 'Basic Gemini model for simple tasks',
    },
    {
      key: 'expert',
      model: 'gemini-2.0-pro',
      description: 'Expert Gemini model for complex tasks',
    }
  ]
})

const ollama = new AxAI({ 
  name: 'ollama', 
  config: { model: "nous-hermes2" }
})

const secretService = {
    key: 'sensitive-secret',
    service: ollama,
    description: 'Ollama model for sensitive secrets tasks'
}

// Create a router with all services
const router = new AxMultiServiceRouter([openai, gemini, secretService])

// Route to OpenAI's expert model
const openaiResponse = await router.chat({
  chatPrompt: [{ role: 'user', content: 'Hello!' }],
  model: 'expert'
})

// Or use the router with AxGen
const gen = new AxGen(`question -> answer`)
const res = await gen.forward(router, { question: 'Hello!' })
```

The load balancer is ideal for high availability while the router is perfect when you need specific models for specific tasks Both can be used with any of Ax's features like streaming, function calling, and chain-of-thought prompting.

**They can also be used together**

You can also use the balancer and the router together either the multiple balancers can be used with the router or the router can be used with the balancer.

## Vercel AI SDK Integration

Install the ax provider package

```shell
npm i @ax-llm/ax-ai-sdk-provider
```

Then use it with the AI SDK, you can either use the AI provider or the Agent Provider

```typescript
const ai = new AxAI({
    name: 'openai',
    apiKey: process.env['OPENAI_APIKEY'] ?? "",
});

// Create a model using the provider
const model = new AxAIProvider(ai);

export const foodAgent = new AxAgent({
  name: 'food-search',
  description:
    'Use this agent to find restaurants based on what the customer wants',
  signature,
  functions
})

// Get vercel ai sdk state
const aiState = getMutableAIState()

// Create an agent for a specific task
const foodAgent = new AxAgentProvider(ai, {
    agent: foodAgent,
    updateState: (state) => {
         aiState.done({ ...aiState.get(), state })
    },
    generate: async ({ restaurant, priceRange }) => {
        return (
            <BotCard>
                <h1>{restaurant as string} {priceRange as string}</h1>
            </BotCard>
        )
    }
})

// Use with streamUI a critical part of building chat UIs in the AI SDK
const result = await streamUI({
    model,
    initial: <SpinnerMessage />,
    messages: [
        // ...
    ],
    text: ({ content, done, delta }) => {
        // ...
    },
    tools: {
        // @ts-ignore
        'find-food': foodAgent,
    }
})
```

## OpenTelemetry support

The ability to trace and observe your llm workflow is critical to building production workflows. OpenTelemetry is an industry-standard, and we support the new `gen_ai` attribute namespace.

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

## Built-in Functions

| Function           | Name               | Description                                  |
| ------------------ | ------------------ | -------------------------------------------- |
| JS Interpreter     | AxJSInterpreter    | Execute JS code in a sandboxed env           |
| Docker Sandbox     | AxDockerSession    | Execute commands within a docker environment |
| Embeddings Adapter | AxEmbeddingAdapter | Fetch and pass embedding to your function    |

## Check out all the examples

Use the `tsx` command to run the examples. It makes the node run typescript code. It also supports using an `.env` file to pass the AI API Keys instead of putting them in the command line.

```shell
OPENAI_APIKEY=openai_key npm run tsx ./src/examples/marketing.ts
```

| Example             | Description                                             |
| ------------------- | ------------------------------------------------------- |
| customer-support.ts | Extract valuable details from customer communications   |
| function.ts         | Simple single function calling example                  |
| food-search.ts      | Multi-step, multi-function calling example              |
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
| streaming3.ts       | End-to-end streaming example `streamingForward()`       |
| smart-hone.ts       | Agent looks for dog in smart home                       |
| multi-modal.ts      | Use an image input along with other text inputs         |
| balancer.ts         | Balance between various llm's based on cost, etc        |
| docker.ts           | Use the docker sandbox to find files by description     |
| prime.ts            | Using field processors to process fields in a prompt    |

## Our Goal

Large language models (LLMs) are becoming really powerful and have reached a point where they can work as the backend for your entire product. However, there's still a lot of complexity to manage from using the correct prompts, models, streaming, function calls, error correction, and much more. We aim to package all this complexity into a well-maintained, easy-to-use library that can work with all state-of-the-art LLMs. Additionally, we are using the latest research to add new capabilities like DSPy to the library.

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
const cot = new AxGen(ai, `question:string -> answer:string`, { functions });
```

## Enable debug logs

```ts
const ai = new AxAI({ name: "openai", apiKey: process.env.OPENAI_APIKEY } as AxOpenAIArgs);
ai.setOptions({ debug: true });
```

## Reach out

We're happy to help reach out if you have questions or join the Discord
[twitter/dosco](https://twitter.com/dosco)

## FAQ

### 1. The LLM can't find the correct function to use

Improve the function naming and description. Be very clear about what the function does. Also, ensure the function parameters have good descriptions. The descriptions can be a little short but need to be precise.

### 2. How do I change the configuration of the LLM I'm using?

You can pass a configuration object as the second parameter when creating a new LLM object.

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

It is essential to remember that we should only run `npm install` from the root directory. This prevents the creation of nested `package-lock.json` files and avoids non-deduplicated `node_modules`.

Adding new dependencies in packages should be done with e.g. `npm install lodash --workspace=ax` (or just modify the appropriate `package.json` and run `npm install` from root).
