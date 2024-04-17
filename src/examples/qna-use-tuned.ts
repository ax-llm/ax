import {
  AI,
  ChainOfThought,
  emScore,
  HFDataLoader,
  MetricFn,
  type OpenAIArgs,
  TestPrompt
} from '../index.js';

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

const program = new ChainOfThought<{ question: string }, { answer: string }>(
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
const hf = new HFDataLoader();
const examples = await hf.getData<{ question: string; answer: string }>({
  dataset: 'hotpot_qa',
  split: 'validation',
  count: 10,
  fields: ['question', 'answer']
});

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: MetricFn = ({ prediction, example }) => {
  return emScore(prediction.answer as string, example.answer as string);
};

const ev = new TestPrompt({ program, examples });
await ev.run(metricFn);

// console.log(res);
