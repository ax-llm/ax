import fs from 'fs';

import {
  AxAI,
  AxAIOpenAIModel,
  AxBootstrapFewShot,
  AxChainOfThought,
  axEvalUtil,
  AxHFDataLoader,
  type AxMetricFn,
  AxRAG
} from '../index.js';

const hf = new AxHFDataLoader({
  dataset: 'yixuantt/MultiHopRAG',
  split: 'train',
  config: 'MultiHopRAG',
  options: { length: 5 }
});

await hf.loadData();

const examples = await hf.getRows<{ question: string; answer: string }>({
  count: 20,
  fields: ['query', 'answer'],
  renameMap: { query: 'question', answer: 'answer' }
});

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4O, maxTokens: 3000 }
});

ai.setOptions({ debug: true });

const fetchFromVectorDB = async (query: string) => {
  const cot = new AxChainOfThought<{ query: string }, { answer: string }>(
    ai,
    'query -> answer:string "answer to the query"'
  );
  const { answer } = await cot.forward({ query });
  return answer;
};

// Setup the program to tune
const program = new AxRAG(ai, fetchFromVectorDB, { maxHops: 1 });

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new AxBootstrapFewShot<
  { question: string },
  { answer: string }
>({
  program,
  examples
});

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) => {
  return axEvalUtil.emScore(
    prediction.answer as string,
    example.answer as string
  );
};

// Run the optimizer
const result = await optimize.compile(metricFn);

// save the resulting demonstrations to use later
const values = JSON.stringify(result, null, 2);
await fs.promises.writeFile('./qna-tune-demos.json', values);

console.log('> done. test with qna-use-tuned.ts');
