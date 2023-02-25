# Minds - Build AI powered workflows easily

[![NPM Package](https://img.shields.io/npm/v/@dosco/minds?style=for-the-badge&color=green)](https://www.npmjs.com/package/@dosco/minds)
[![Twitter](https://img.shields.io/twitter/follow/dosco?style=for-the-badge&color=red)](https://twitter.com/dosco)
[![Discord Chat](https://dcbadge.vercel.app/api/server/2WsGjtk4?style=for-the-badge)](https://discord.gg/2WsGjtk4)

A JS library (Typescript) that makes it easy to build your workflows and app backends with large language models (LLMs) like **OpenAI** and **Cohere**.

This library handles all the **complex prompt engineering** so you can focus on building amazing things like context power chat, question answering, natural language search in minutes. Define Javascript functions that AIs can use. For example the AI can lookup your database, call an API or search the web while answering a business question.

We totally believe that AI will soon replace your entire app backend. We truly live in amazing times. Please join our Discord so we can help you build your idea.

```console
npm i @dosco/minds
```

## AI Powered Business Workflows

Build business or personal workflows where the AI calls your APIs to fetch data and use that data to solve problems or answer your questions.

For example we can build a workflow to automate replying to customers support emails.

```js
// Fake search action to simulate a product database search
const productSearch = (_text) => {
  return `
  Name: Macbook Pro M2
  Details: Ram 32GB
  In Stock: True
  --
  Name: Macbook Pro M2
  Details: Ram 96GB
  In Stock: False`;
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

// Business query to automate customer support emails
const query = `
Do we have the product the email referes to in stock?
Email: ${email}`;

await gen.generate(query, prompt);
```

```console
> No, we dont have the Macbook Pro M2 With 96GB RAM in stock.
```

## AI Smart Assistant

Build an AI powered assistant that maintains context as you converse with it asking if various questions.

```javascript
import {
  Cohere,
  OpenAI,
  Memory,
  GenerateText,
  AssistantPrompt,
} from '@dosco/minds';

// const ai = new Cohere(process.env.COHERE_APIKEY)
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

| Example            | Description                                             |
| ------------------ | ------------------------------------------------------- |
| ask-questions-1.js | AI uses Google search to find the correct answer        |
| ask-questions-2.js | AI powered customer support email handling              |
| chat-assistant.js  | AI chat bot capable of intellegent conversations        |
| get-summary.js     | AI to generate a shprt summary of a large block of text |

```terminal
cd examples
npm i
node chat-assistant.js
```

## Why use Minds?

Large language models (LLMs) are getting really powerful and have reached a point where they can work as the back for your entire product. However since its all cutting edge technology you have to manage a lot of complexity from using the right prompts, models, etc. Our goal is to package all this complexity into a well maintained easy to use library that can work with all the LLMs out there.

## Docs

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

## Reach out

We're happy to help you leverage Minds reach out if you have questions

[twitter/dosco](https://twitter.com/dosco)

## Prompt Engineering

There is a bit of magic to getting an LLM (AI) to do your bidding. For fans of boarding school going wizards it's sort of like learning spells that trigger patterns deep inside the latent space of the model. This is the new and exciting field of [Prompt Engineering](https://42papers.com/c/llm-prompting-6343) and this library is how we turn these spells into code to help make building with AI a more democratic endevour. Join us we're just getting started.
