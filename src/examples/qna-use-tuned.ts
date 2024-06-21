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

// load tuning data
// program.loadDemos('demos.json');

// use directly
// const res = await gen.forward({
//   question: 'What castle did David Gregory inherit?'
// });

// or test to see performance
const hf = new AxHFDataLoader();
const examples = await hf.getData<{ question: string; answer: string }>({
  dataset: 'hotpot_qa',
  split: 'validation',
  count: 10,
  fields: ['question', 'answer']
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

// console.log(res);
