import fs from 'node:fs';

import { AxAI, AxAIOpenAIModel, AxChainOfThought } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4O }
});

const gen = new AxChainOfThought(ai, `question, animalImage:image -> answer`);

const image = fs
  .readFileSync('./src/examples/assets/kitten.jpeg')
  .toString('base64');

const res = await gen.forward({
  question: 'What family does this animal belong to?',
  animalImage: { mimeType: 'image/jpeg', data: image }
});

console.log('>', res);
