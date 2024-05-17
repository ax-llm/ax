import {
  AI,
  BootstrapFewShot,
  ChainOfThought,
  emScore,
  HFDataLoader,
  type MetricFn,
  type OpenAIArgs,
  RAG
} from '../index.js';

const hf = new HFDataLoader();
const examples = await hf.getData<{ question: string; answer: string }>({
  dataset: 'hotpot_qa',
  split: 'train',
  count: 100,
  fields: ['question', 'answer']
});

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

const fetchFromVectorDB = async (query: string) => {
  const cot = new ChainOfThought<{ query: string }, { answer: string }>(
    ai,
    'query -> answer'
  );
  const { answer } = await cot.forward({ query });
  return answer;
};

// Setup the program to tune
const program = new RAG(ai, fetchFromVectorDB, { maxHops: 3 });

// Setup a Bootstrap Few Shot optimizer to tune the above program
const optimize = new BootstrapFewShot<{ question: string }, { answer: string }>(
  {
    program,
    examples
  }
);

// Setup a evaluation metric em, f1 scores are a popular way measure retrieval performance.
const metricFn: MetricFn = ({ prediction, example }) => {
  return emScore(prediction.answer as string, example.answer as string);
};

// Run the optimizer and save the result
await optimize.compile(metricFn, { filename: 'demos.json' });

console.log('> done. test with qna-use-tuned.ts');
