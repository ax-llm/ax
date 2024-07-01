import fs from 'fs';

import {
  AxAI,
  AxChainOfThought,
  axEvalUtil,
  AxHFDataLoader,
  type AxMetricFn,
  AxTestPrompt
} from '../index.js';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`
);

const values = await fs.promises.readFile('./qna-tune-demos.json', 'utf8');
const demos = JSON.parse(values);

// load tuning data
program.setDemos(demos);

// use directly
// const res = await gen.forward({
//   question: 'What castle did David Gregory inherit?'
// });

// or test to see performance
const hf = new AxHFDataLoader({
  // cspell: disable-next-line
  dataset: 'yixuantt/MultiHopRAG',
  split: 'train',
  config: 'MultiHopRAG',
  options: { length: 20 }
});

await hf.loadData();

const examples = await hf.getRows<{ question: string; answer: string }>({
  count: 10,
  fields: ['query', 'answer'],
  renameMap: { query: 'question', answer: 'answer' }
});

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: AxMetricFn = ({ prediction, example }) => {
  return axEvalUtil.emScore(
    prediction.answer as string,
    example.answer as string
  );
};

const ev = new AxTestPrompt({ program, examples });
await ev.run(metricFn);
