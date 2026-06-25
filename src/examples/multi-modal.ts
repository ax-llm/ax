import fs from 'node:fs';

import { AxAIOpenAIModel, ax, ai as createAI } from '@ax-llm/ax';

const gen = ax('question, animalImage:image -> answer');

const image = fs
  .readFileSync('./src/examples/assets/kitten.jpeg')
  .toString('base64');

const ai = createAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT54 },
  options: { debug: true },
});

const res = await gen.forward(ai, {
  question: 'What family does this animal belong to?',
  animalImage: { mimeType: 'image/jpeg', data: image },
});

console.log('>', res);
