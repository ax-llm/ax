import { AI, ChainOfThought, type OpenAIArgs } from '../index.js';

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

const gen = new ChainOfThought<{ question: string }, { answer: string }>(
  ai,
  `question -> answer "in short 2 or 3 words"`
);

// load tuning data
gen.loadDemos('demos.json');

const res = await gen.forward({
  question: 'What castle did David Gregory inherit?'
});

console.log(res);
