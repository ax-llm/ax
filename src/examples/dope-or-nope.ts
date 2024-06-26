import {
  AxAI,
  AxAIOpenAIModel,
  AxBootstrapFewShot,
  AxChainOfThought,
  axEvalUtil,
  AxHFDataLoader,
  type AxMetricFn
} from '../index.js';

const hf = new AxHFDataLoader();
const dataset = encodeURIComponent('llm-wizard/dope_or_nope_v2');
const examples = await hf.getData<{ question: string; answer: string }>({
  dataset,
  split: 'train',
  count: 5,
  config: 'default',
  fields: ['Sentence', 'Rating'],
  renameMap: { Sentence: 'question', Rating: 'answer' }
});

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT35Turbo }
});

// Setup the program to tune
const program = new AxChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "numerical rating from 1 to 4"`
);

// The only way to get the success to increment is to set the trace
program.setTrace({
  question: examples[0]!.question as string,
  answer: examples[0]!.answer as string,
  source: 'initial'
});

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

// Run the optimizer and save the result
await optimize.compile(metricFn, { filename: 'demos.json' });

console.log('> done. test with dope-or-nope.ts');
