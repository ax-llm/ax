# LLMClient - A framework for building with LLMs

🌵 🦙 🔥 ❤️ 🖖🏼

[![NPM Package](https://img.shields.io/npm/v/llmclient?style=for-the-badge&color=green)](https://www.npmjs.com/package/llmclient)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://dcbadge.vercel.app/api/server/DSHg3dU7dW?style=for-the-badge)](https://discord.gg/DSHg3dU7dW)

![llama-small](https://github.com/dosco/llm-client/assets/832235/b959fdd6-c723-49b1-9fb9-bf879e75c147)

## Build LLMs powered workflows.

LLMClient is an easy to use library for building powerful workflows using components like RAG, ReAcT, Chain of Thought, Function calling, Agents, etc. Chain together components using simple JS/TS code and build maintainable LLM powered workflows.

## Why use LLMClient?

- Support for various LLMs and Vector DBs
- A lite low dependecies library
- Prompts auto-generated from simple signatures
- Multi-Hop RAG, ReAcT, CoT, Function Calling, Agents and more

## Whats a prompt signature?

```typescript
"Write a simple search query that will help answer a complex question."
context?:string[] "may contain relevant facts", question -> query
```

Efficient type-safe prompts are auto-generated from a simple signature. A prompt signature is made of a `"description" inputField:type -> outputField:type"`. The idea behind prompt signatures is based off work done in the "Demonstrate-Search-Predict" paper.

## LLM's Supported

| Provider      | Best Models              | Tested  |
| ------------- | ------------------------ | ------- |
| OpenAI        | GPT: 4, 3.5/4-Turbo      | 🟢 100% |
| Azure OpenAI  | GPT: 4, 3.5/4-Turbo      | 🟢 100% |
| Together      | Several OSS Models       | 🟢 100% |
| Cohere        | Command, Command Nightly | 🟡 100% |
| Anthropic     | Claude 2, Claude 3       | 🟡 50%  |
| Google Vertex | Palm, Bison              | 🟡 50%  |
| Google Gemini | Gemini 1.0               | 🟡 50%  |
| Hugging Face  | OSS Model                | 🟡 50%  |
| Groq          | Lama2-70B, Mixtral-8x7b  | 🟡 50%  |

## Example: Using chain-of-thought to summarize text

```typescript
import { AI, ChainOfThought, OpenAIArgs } from 'llmclient';

/const textToSummarize = `
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

Work in progress.

## Checkout more examples

```shell
OPENAI_APIKEY=openai_key npx tsx ./src/examples/marketing.ts
```

| Example             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| customer-support.ts | Extract valuable details from customer communications  |
| food-search.ts      | Use multiple APIs are used to find dinning options     |
| marketing.ts        | Generate short effective marketing sms messages        |
| fibonacci.ts        | Use the JS code interpreter to compute fibonacci       |
| summarize.ts        | Generate a short summary of a large block of text      |
| chain-of-thought.ts | Use chain-of-thought prompting to answer questions     |
| rag.ts              | Use multi-hop retrieval to answer questions            |
| react.ts            | Use function calling and reasoning to answer questions |

## Reasoning + Function Calling

Often you need the LLM to reason through a task and fetch and update external data related to this task. This is where reasoning meets function (API) calling. It's built-in so you get all of the magic automatically. Just define the functions you wish to you, a schema for the response object and thats it.

There are even some useful built-in functions like a `Code Interpreter` that the LLM can use to write and execute JS code.

We support providers like OpenAI that offer multiple parallel function calling and the standard single function calling.

## Built-in Functions

| Function           | Description                                            |
| ------------------ | ------------------------------------------------------ |
| Code Interpreter   | Used by the LLM to execute JS code in a sandboxed env. |
| Embeddings Adapter | Wrapper to fetch and pass embedding to your function   |

## Our Goal

Large language models (LLMs) are getting really powerful and have reached a point where they can work as the backend for your entire product. However there is still a lot of manage a lot of complexity to manage from using the right prompts, models, etc. Our goal is to package all this complexity into a well maintained easy to use library that can work with all the LLMs out there. Additionally we are using the latest research to add useful new capabilities like DSP to the library.

## How to use this library?

### 1. Pick an AI to work with

```ts
// Pick a LLM
const ai = new OpenAI({ apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
```

### 2. Pick a memory for storing context (optional)

```ts
// Can be sub classed to build you own memory backends
const mem = new Memory();
```

### 3. Pick a prompt based on your usecase

```ts
const cot = new ChainOfThought(ai, `question:string -> answer:string`, { mem });
```

### 4. Use the prompt

```ts
const res = await cot.forward({ question: 'Are we in a simulation?' });
```

### 5. Alternatively use the LLM directly.

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
