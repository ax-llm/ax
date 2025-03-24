---
title: Prompt Tuning Basic
description: You can tune your prompts using a larger model to help them run more efficiently and give you better results.
---

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