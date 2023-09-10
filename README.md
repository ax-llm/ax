# LLMClient 🌵 🦙 🔥 ❤️ 🖖🏼
### An LLM proxy to log prompts, debug, etc and a multi-llm library to build llm powered chat, function calling, reasoning and other apps.

Automatically log all prompts, responses, model configuration, etc to make it easier to debug or keep track of what worked and what did not.
A must have for building with LLMs. It's packed with useful features.

[![NPM Package](https://img.shields.io/npm/v/llmclient?style=for-the-badge&color=green)](https://www.npmjs.com/package/llmclient)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://dcbadge.vercel.app/api/server/DSHg3dU7dW?style=for-the-badge)](https://discord.gg/DSHg3dU7dW)

![llama-small](https://github.com/dosco/llm-client/assets/832235/b959fdd6-c723-49b1-9fb9-bf879e75c147)

1. Proxy for Debugging, Tracing, Caching
2. Guardrails, Extract JSON,
3. LLM Independant Function Calling
4. Chain of Though Reasoning
5. Since interface to all LLMs
6. Simpler and smaller than the alternatives
7. Sensible Defaults
8. Single interface to OpenAI, GoogeAI, Anthropic, Together, HF and more

## AI's Supported


| AI           | Best Model                           | Proxy | Functions + CoT |
| ------------ | ------------------------------------ | ----- | --------------- |
| OpenAI       | GPT: 3.5, 3.5-16K, 4, 4-32K          | ✅    | 🟢 100%         |
| Anthropic    | Claude Instant, Claude 2             | ✅    | 🟢 100%         |
| Azure OpenAI | GPT: 3.5, 3.5-16K, 4, 4-32K          | ✅    | 🟢 100%         |
| Google AI    | Text Bison, Chat Bison, Gecko        | ✅    | 🟢 100%         |
| Together     | Llama 2                              | ✅    | 🟢 90%          |
| Hugging Face | Llama 2                              | ✅    | 🟡 90%          |
| Cohere       | Command, Command Nightly             | ✅    | 🟡 40%          |
| AlephaAlpha  | Luminous: Control, Supreme, Extended | No    | 🔴 N/A          |

## Debug your LLM interactions with a tracing proxy.

A quick proxy server to help debug and trace all your llm interactions while you develop your prompts and LLM powered apps. The proxy has builtin caching to speedup your dev workflows and to save you from paying token costs. **The proxy works with any llm api in any language you don't even have to use llmclient.**

> If you want to view your traces to the hosted web ui then just set the `LLMC_APIKEY` environment variable to your app key from llmclient.com

Start local dev proxy server on port 8081

```console
npx llmclient:latest proxy
```

Point your code to local dev proxy server

```
http://localhost:8081/openai/v1
```

Connect your LLM code to the proxy server

```javascript
// Example using openai client library
import OpenAI from 'openai';

// Point the openai client to the proxy
const openai = new OpenAI({
  baseURL: 'http://localhost:8081/openai/v1',
  apiKey: process.env.OPENAI_APIKEY,
});

const chatCompletion = await openai.chat.completions.create({
  messages: [{ role: 'user', content: 'Say this is a test' }],
  model: 'gpt-3.5-turbo',
});

console.log(chatCompletion);
```

## Web UI for Debugging, Tracing and Metrics

A free web ui designed to help you debug and log your LLM interactions. Working with LLMs is hard since there are so many variables to control. The LLMClient web-ui makes it easy to do it by logging every detail around your LLM usage and provide you a central place to view, track, share and compare it.

To enable sign-up at https://llmclient.com and get your API Key. Then set any one of these two enviroment variables `LLMC_APIKEY` or `LLMCLIENT_APIKEY`

```
# This is a fake key for example purposes
LLMC_APIKEY = "lc-ebcec216be72f3c7862307acc4a03e5fdc4991da6780cab312601e66e7344c32"

```

![traces](https://github.com/dosco/llm-client/assets/832235/03d392fa-3513-4397-ba98-c117f9abf3c4)

## A simple library to build with all supported LLMs

```javascript
import { OpenAI, AIMemory, AIPrompt } from 'llmclient';

// Support for OpenAI, AzureAI, GoogleAI, Cohere, etc...
const ai = new OpenAI(process.env.OPENAI_APIKEY);

// Has built-in support for reasoning, function calling, error correction, etc
const prompt = new AIPrompt();

// Optional state storage memory
const memory = new AIMemory();

// Execute the prompt
const res = await prompt.generate(ai, `What is your name?`, {
  memory,
  // sessionID,
  // rateLimiter
});

// Print the result
console.log(res.value());
```

## Code Examples (Apps)

[LLMClient Example Apps](/examples/README.md)

| Example               | Description                                               |
| --------------------- | --------------------------------------------------------- |
| meetings.js           | Meeting transcript converted into multiple Trello tasks   |
| product-search.js     | Call an API to answer product related questions           |
| food-search.js        | Multiple APIs are used to lookup the best eating options  |
| fibonacci.js          | Use the built-in JS code interpreter to compute fibonacci |
| vector-search.js      | Simple example using vector db and embeddings             |
| customer-support.js   | Extract valuable details from customer communications     |
| marketing.js          | Use AI to generate short effective marketing sms messages |
| transcribe-podcast.js | Transcribe multiple podcast channels into text            |
| chat-assistant.js     | AI chat bot capable of intellegent conversations          |
| get-summary.js        | AI to generate a short summary of a large block of text   |
| ai-vs-ai.js           | OpenAI has a friendly chat with Cohere                    |



## Function (API) Calling with reasoning (CoT)

Often you need the LLM to reason through a task and fetch and update external data related to this task. This is whre reasoning meets function (API) calling. It's built-in so you get all of the magic automatically. Just define the functions you wish to you, a schema for the response object and thats it.

There are even some useful built-in functions like a `Code Interpreter` that the LLM can use to write and execute JS code.

Build a meeting notes app backed by a task management tool that figures out the decided tasks and creates and assigns the tasks correctly as cards in Trello, Asana or Jira. Or a food finding app that uses the weather and google places api to find a place to eat at.

You can truly build your entire backend with LLMs using this capability. To me this feels like magic.

## Built-in Functions

| Function           | Description                                            |
| ------------------ | ------------------------------------------------------ |
| Code Interpreter   | Used by the LLM to execute JS code in a sandboxed env. |
| Embeddings Adapter | Wrapper to fetch and pass embedding to your function   |

## Example using Custom Functions

```js
const productDB = [
  { name: 'Macbook Pro', description: 'M2, 32GB', in_stock: 4321 },
  { name: 'Macbook Pro', description: 'M2, 96GB', in_stock: 2 },
  { name: 'iPad M1', description: 'M1, 8GB', in_stock: 0 },
];

const inventorySearch = ({ name, count }) => {
  return JSON.stringify(
    productDB.filter((v) => name.includes(v.name) && v.in_stock >= count)
  );
};

// List of functions available to the AI and the schema of the functions inputs
const functions = [
  {
    name: 'inventorySearch',
    description: 'Used to search up a products inventory by its name',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'name of the product',
        },
        count: {
          type: 'number',
          description: 'number of products to search for',
        },
      },
      required: ['name', 'count'],
    },
    func: inventorySearch,
  },
];

const customerQuery = `Do you guys have 5 Macbook Pro's M2 with 96GB RAM and 3 iPads in stock?`;

// The schema of the final response you expect from this prompt
const resultSchema = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: 'response message for the sender',
    },
  },
};

// Setup the prompt with the response schema and functions
const prompt = new SPrompt(resultSchema, functions);
prompt.setDebug(true);

// Execute the prompt and get the response
const res = await prompt.generate(ai, customerQuery);
console.log(res.value());
```

Response

```json
{
  "data": [
    {
      "name": "Macbook Pro M2",
      "units": 5,
      "desc": "M2, 32GB"
    },
    {
      "name": "iPad",
      "units": 0
    }
  ],
  "response": "We have 2 Macbook Pro's M2 with 96GB RAM and 0 iPads in stock."
}
```

Usage Stats in Response.

The usage stats are useful to be able to compute costs and usage information.

```json
[
  {
    "model": {
      "id": "gpt-3.5-turbo-0613",
      "currency": "usd",
      "promptTokenCostPer1K": 0.002,
      "completionTokenCostPer1K": 0.002,
      "maxTokens": 4096,
      "oneTPM": 1
    },
    "stats": {
      "promptTokens": 1067,
      "completionTokens": 223,
      "totalTokens": 1290
    }
  }
]
```

## Extract Details From Messages

Extracting information from text is one of the most useful thing LLMs can do. You can either use the more specialized `ExtractInfoPrompt` which should work even with simpler LLMs or use the `SPrompt` with or without functions and the `resultSchema` to do the same.

```js
const entities = [
  { name: BusinessInfo.ProductName },
  { name: BusinessInfo.IssueDescription },
  { name: BusinessInfo.IssueSummary },
  { name: BusinessInfo.PaymentMethod, classes: ['Cash', 'Credit Card'] },
];

const prompt = new ExtractInfoPrompt(entities);

const customerMessage = `
I am writing to report an issue with my recent order #12345. I received the package yesterday, but 
unfortunately, the product that I paid for with cash (XYZ Smartwatch) is not functioning properly. 
When I tried to turn it on, the screen remained blank, and I couldn't get it to respond to any of 
the buttons.

Jane Doe`;

const res = await prompt.generate(ai, customerMessage);
```

Extracted Details From Customer Message:

```console
{
  'Product Name' => [ 'XYZ Smartwatch' ],
  'Issue Description' => [ 'Screen remained blank and unable to respond to any buttons' ],
  'Issue Summary' => [ 'Product is not functioning properly' ],
  'Payment method' => [ 'Cash' ]
}
```

## Why use LLM Client?

Large language models (LLMs) are getting really powerful and have reached a point where they can work as the backend for your entire product. However since its all cutting edge technology you have to manage a lot of complexity from using the right prompts, models, etc. Our goal is to package all this complexity into a well maintained easy to use library that can work with all the LLMs out there.

## How to use this library?

### 1. Pick an AI to work with

```js
// Use Cohere AI
const ai = new Cohere(process.env.COHERE_APIKEY);

// Use OpenAI
const ai = new OpenAI(process.env.OPENAI_APIKEY);
```

### 2. Pick a memory for storing context (optional)

```js
// Can be sub classed to build you own memory backends
// like one that uses redis or a database (not required)
const memory = new Memory();
```

### 3. Pick a prompt based on your usecase

```js
// Base prompt to extend for your own usecases
const prompt = new AIPrompt();

// Or A prompt (extended from AIPrompt) to handle
// api calling and structured responses
const prompt = new SPrompt(resultSchema, functions);
```

### 4. Engage the AI

```js
// Query the AI
const res = await prompt.generate(
  ai,
  `Do we have the product the email referes to in stock? 
  Email: I'm looking for a Macbook Pro M2 With 96GB RAM.`
);

// Get the response
console.log('>', res.value());
```

## What is Function (API) Calling?

API calls in large language models like GPT-4 are really useful. It's like allowing these models to talk with other computer programs and services. This means they can do more than just create text. For example, they can use an API call to get new data or work with another program to do a job. This makes them much more flexible and useful in many different situations.

For example:

**Weather App:** Let's say you're using a chatbot (powered by a language model like GPT-4) and you ask, "What's the weather like today?" The chatbot doesn't know the current weather, but it can use an API call to ask a weather service for this information. Then, it can understand the response and tell you, "It's going to be sunny and 75 degrees today."

**Music Recommendation:** Imagine you ask a smart assistant (also powered by a language model) to recommend a new song you might like. The assistant could use an API call to ask a music streaming service (like Spotify) for suggestions based on your past listens. Then it could tell you, "You might enjoy the new song by your favorite artist."

**Restaurant Lookup:** If you ask a chatbot, "Find me a good Italian restaurant nearby," it could use an API call to ask a service like Yelp or Google Maps to find Italian restaurants in your area. Then, it can share the results with you.

```js
const inventorySearch = ({ name, count }) => {
  return JSON.stringify(
    productDB.filter((v) => name.includes(v.name) && v.in_stock >= count)
  );
};

const functions = [
  {
    // function name
    name: 'inventorySearch',
    // description
    description: 'Used to search up a products inventory by its name',
    // json schema defining the function input
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'name of the product',
        },
        count: {
          type: 'number',
          description: 'number of products to search for',
        },
      },
      required: ['name', 'count'],
    },
    // the js function to call
    func: inventorySearch,
  },
];
```

Finally pass the functions list to the prompt.

```js
// json schema defining the final response object
const resultSchema = {
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          units: { type: 'number' },
          desc: { type: 'string' },
        },
      },
    },
  },
};

const prompt = new SPrompt(resultSchema, functions);
```

## Detailed Debug Logs

```js
const prompt = new SPrompt(restaurant, funcs);
prompt.setDebug(true);
```

```console
🔎 Trace 1
____________________________________________
  Trace ID: 2e7-25db-4b40-95b6-0c6a48f03683
  Session ID: <not-set>

📘 Model Info:
  ID: gpt-3.5-turbo-0613
  Currency: usd
  Character Is Token: <not-set>
  Prompt Token Cost Per 1K: 0.002
  Completion Token Cost Per 1K: 0.002
  Max Tokens: 4096
  One TPM: 1

🛠️  Model Config:
  maxTokens: 1000
  temperature: 0
  topP: 1
  n: <not-set>
  stream: <not-set>
  logprobs: <not-set>
  echo: <not-set>
  presencePenalty: <not-set>
  frequencyPenalty: <not-set>
  bestOf: <not-set>
  logitBias: <not-set>

📝 Response:
  Model Response Time: 1894
  Embed Model Response Time: <not-set>

🚀 Function Executions:
  Function 1: findRestaurants
  Arguments: {"location":"San Francisco","outdoor":true,"cuisine":"sushi","priceRange":"$$"}
  Result: ...
  Result Value: <not-set>
  Reasoning: I have found some restaurants in San Francisco that have outdoor seating and serve sushi., I need to choose a restaurant based on my preferences.
  Reasoning: <not-set>
```

## Troubleshooting

1. **The LLM can't find the right function to use from the ones I've provided**
   Improve the function naming and description be very clear on what the function does. Also ensure the function parameter's also have good descriptions. The descriptions don't have to be very long but need to be clear.

2. **How do I change the configuration of the LLM used**
   You can pass a configuration object as the second parameter when creating a new LLM object `const conf = OpenAIDefaultOptions(); const ai = new OpenAI(APIKEY, conf);`

3. **My prompt is too long and is getting cut off for some reason**
   Increase the max token length `const conf = OpenAIDefaultOptions(); conf.maxTokens = 2000;`

4. **How do I change the model say I want to use GPT4 instead of the default**
   Change it on the configuration `const conf = OpenAIDefaultOptions(); conf.model = OpenAIGenerateModel.GPT4;` another way is to use another preset instead of the default. `const conf = OpenAIBestModelOptions();`

5. **How do I get debug logs**
   You have to enable it on the the prompt object `const prompt = new SPrompt(restaurant, funcs); prompt.setDebug(true);` and the logs will be displayed on the console.

## Reach out

We're happy to help reach out if you have questions or join the Discord

[twitter/dosco](https://twitter.com/dosco)
