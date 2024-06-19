import fs from 'fs';

import {
  axAI,
  AxChainOfThought,
  type AxOpenAIArgs,
  AxOpenAIModel
} from '../index.js';

const ai = axAI('openai', {
  apiKey: process.env.OPENAI_APIKEY,
  config: { model: AxOpenAIModel.GPT4O }
} as AxOpenAIArgs);

const gen = new AxChainOfThought(ai, `question, animalImage:image -> answer`);

const image = fs
  .readFileSync('./src/examples/assets/kitten.jpeg')
  .toString('base64');

const res = await gen.forward({
  question: 'What family does this animal belong to?',
  animalImage: { mimeType: 'image/jpeg', data: image }
});

console.log('>', res);
