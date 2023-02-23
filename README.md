# MindsJS - Making AI Easy to use

[![NPM Package](https://img.shields.io/npm/v/@dosco/minds?style=for-the-badge&color=#32CD32)](https://www.npmjs.com/package/@dosco/minds)


MindsJS is a JS library (Typescript) that makes it easy to build your app with large language models (LLMs) like **OpenAI** and **Cohere**.

Build features like context specific chat, question answering, etc in minutes. You can even define Javascript functions as actions for the AI to use. For example the AI can lookup your database, call an API or search the web while answering a business question.

Don't believe us try out the examples :smiley:

```console
npm i @dosco/minds
```

## AI Smart Assistant

Build an AI powered assistant that maintains context as you converse with it asking if various questions.

```js
import { Cohere, OpenAI, Memory, GenerateText, AssistantPrompt } from 'minds';

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
> No, we don't have the product the email refers to in stock.
```

## Example Apps

- ask-questions-1.js : AI uses Google search to find the correct answer
- ask-questions-2.js : AI powered customer support email handling
- chat-assistant.js : AI chat bot capable of intellegent conversations.
- get-summary.js : AI to generate a shprt summary of a large block of text"

```terminal
cd examples
npm i
node chat-assistant.js
```

## About

Large language models (LLMs) are getting really powerful and have reached a point where they can work as the back for your entire product. However since its all cutting edge technology you have to manage a lot of complexity from using the right prompts, models, etc. Our goal is to package all this complexity into a well maintained easy to use library that can work with all the LLMs out there. 

## Docs

While the API is simple enough and designed to be self-documentating we are currently working on a docs page

## Reach out

We're happy to help you leverage GraphJin reach out if you have questions

[twitter/dosco](https://twitter.com/dosco)

[discord/graphjin](https://discord.gg/6pSWCTZ) (Chat)
