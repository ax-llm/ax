# Minds - Build AI Powered Workflows!

[![NPM Package](https://img.shields.io/npm/v/@dosco/minds?style=for-the-badge&color=green)](https://www.npmjs.com/package/@dosco/minds)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://dcbadge.vercel.app/api/server/2WsGjtk4?style=for-the-badge)](https://discord.gg/2WsGjtk4)

<img align="right" width="300" height="300" style="padding: 0px" src="https://i.imgur.com/02KP6OU.png">

A JS library (Typescript) that makes it easy to build your workflows and app backends with large language models (LLMs) like **OpenAI**, **Cohere** and **AlephAlpha**.

This library handles all the **complex prompt engineering** so you can focus on building amazing things like context power chat, question answering, natural language search in minutes. Define Javascript functions that AIs can use. For example the AI can lookup your database, call an API or search the web while answering a business question.

We totally believe that AI will soon replace your entire app backend. We truly live in amazing times. Please join our Discord so we can help you build your idea.

```console
npm i @dosco/minds
```

## AI Powered Business Workflows

Build business or personal workflows where the AI calls your APIs to fetch data and use that data to solve problems or answer your questions.

For example we can build a workflow to automate replying to customers support emails.

```js
const productDB = [
  { name: 'Macbook Pro', description: 'M2, 32GB', in_stock: 4321 },
  { name: 'Macbook Pro', description: 'M2, 96GB', in_stock: 2 },
];

const productSearch = (text) => {
  return JSON.stringify(productDB.filter((v) => text.includes(v.name)));
};

const actions = [
  {
    name: 'Product Search',
    description: 'Used to search up a products information by its name',
    action: productSearch,
  },
];

const prompt = new QuestionAnswerPrompt(actions);
const gen = new GenerateText(ai);

// Customer support email
const customerQuery = `Do you guys have 5 Macbook Pro's M2 with 96GB RAM and 3 iPads in stock?`;

await gen.generate(query, prompt);
```

```console
>  Answer for customer: We have 2 Macbook Pro's M2 with 96GB RAM and 0 iPads in stock.
```

## AI Smart Assistant

Build an AI powered assistant that maintains context as you converse with it asking if various questions.

```javascript
import {
  Cohere,
  AlephAlpha,
  OpenAI,
  Memory,
  GenerateText,
  AssistantPrompt,
} from '@dosco/minds';

// const ai = new Cohere(process.env.COHERE_APIKEY)
// const ai = new AlephAlpha(process.env.AALPHA_APIKEY)

const ai = new OpenAI(process.env.OPENAI_APIKEY);

const prompt = new AssistantPrompt();
const gen = new GenerateText(ai);

await gen.generate(`How far is the sun from the moon?`, prompt);
await gen.generate(`And from mars?`, prompt);
await gen.generate(`Will it ever end?`, prompt);
```

```console
❯ node chat-assistant.js
AI: How far is the sun from the moon?
> The sun is about 384,400 kilometers away from the moon.

AI: And from mars?
> The sun is about 384,400 kilometers away from Mars as well.

AI: will it ever end?
> The sun will eventually end, but not for billions of years.
```

## Example Apps

| Example             | Description                                             |
| ------------------- | ------------------------------------------------------- |
| ask-questions.js    | AI uses Google search to find the correct answer        |
| customer-support.js | AI powered customer support email handling              |
| chat-assistant.js   | AI chat bot capable of intellegent conversations        |
| get-summary.js      | AI to generate a short summary of a large block of text |
| ai-vs-ai.js         | OpenAI has a friendly chat with Cohere                  |

```terminal
cd examples
npm i
node chat-assistant.js
```

## Why use Minds?

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
// like one that uses redis or a database
const mem = new Memory();
```

### 3. Pick a prompt based on your usecase

```js
// For building conversational chat based AI workflows
const prompt = new AssistantPrompt();

// For building question answer workflows where the
// AI can search the web, or lookup your database to
// answer questions
const prompt = new QuestionAnswerPrompt(actions);
```

### 4. Engage the AI

```js
// Use this for all text generation tasks
const gen = new GenerateText(ai, mem);

// Query the AI
const res = await gen.generate(
  `Do we have the product the email referes to in stock? 
  Email: I'm looking for a Macbook Pro M2 With 96GB RAM.`,
  prompt
);

// Get the response
console.log('>', res.value);
```

## What are actions?

Actions are functions that you define and the API can then call these functions to fetch data it needs to come up with the final answer. All you have to do is pass a list of actions to a prompt that supports actions like the `QuestionAnswerPrompt`.

Embeddings are also supported. If you use a function with two arguments then the embeddings for the `text` (first argument) will be passedi in the second argument. Embeddings can be used with a vector search engine to find similiar things. For example to fetch similiar text paragraphs when coming up with a correct answer.

```js
// Action without embeddings
const productSearch(text) {
  return result
}

// Action with embeddings
const productSearch(text, embeds) {
  return result
}
```

You must specify a name and a clear description matching what the action does. The action itself is a function on the action object that you define.

```js
const actions = [
  {
    name: 'Product Search',
    description: 'Used to search up a products information by its name',
    action: productSearch,
  },
  {
    name: 'Math Solver',
    description: 'Used to solve math problems',
    action: wolframAlphaSearch,
  },
  {
    name: 'Javascript Compiler',
    description: 'Used to compile and execute Javascript code',
    action: javascriptCompile,
  },
];
```

Finally pass the action list to the prompt.

```js
const prompt = new QuestionAnswerPrompt(actions);
```

## Reach out

We're happy to help you leverage Minds reach out if you have questions

[twitter/dosco](https://twitter.com/dosco)

## Prompt Engineering

There is a bit of magic to getting an LLM (AI) to do your bidding. For fans of boarding school going wizards it's sort of like learning spells that trigger patterns deep inside the latent space of the model. This is the new and exciting field of [Prompt Engineering](https://42papers.com/c/llm-prompting-6343) and this library is how we turn these spells into code to help make building with AI a more democratic endevour. Join us we're just getting started.

## Featured AI Art

MidJourney Art by [AmitDeshmukh](https://twitter.com/AmitDeshmukh)

> Prompt: kids walking on a dirt road through a futuristic village, field of daisies on both sides, futuristic clothing, some traditional homes, cumulus clouds, bright mid morning sunlight, birds and drone
