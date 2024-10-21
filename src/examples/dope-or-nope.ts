import fs from 'fs';

import {
  AxAI,
  AxBootstrapFewShot,
  AxChainOfThought,
  AxHFDataLoader,
  type AxMetricFn
} from '@ax-llm/ax';

const hf = new AxHFDataLoader({
  dataset: 'llm-wizard/dope_or_nope_v2',
  split: 'train',
  config: 'default'
});

await hf.loadData();

const examples = await hf.getRows<{ question: string; answer: number }>({
  count: 5,
  fields: ['Sentence', 'Rating'],
  renameMap: { Sentence: 'question', Rating: 'answer' }
});

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

// Setup the program to tune
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  `question -> answer:number "numerical rating from 1 to 4"`
);

// use examples if you have separate examples and tuning data sets without overlap.
// program.setExamples(examples);

const optimize = new AxBootstrapFewShot<
  { question: string },
  { answer: string }
>({
  ai,
  program,
  examples
});

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) => {
  return prediction.answer === example.answer;
};

// Run the optimizer
const result = await optimize.compile(metricFn);

// save the resulting demonstrations to use later
const values = JSON.stringify(result, null, 2);
await fs.promises.writeFile('./dope-or-nope-demos.json', values);

console.log('> done. test with dope-or-nope.ts');
