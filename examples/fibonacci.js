import {
  Memory,
  SPrompt,
  Anthropic,
  Together,
  Cohere,
  OpenAI,
  JSInterpreterFunction,
} from 'llmclient';

import 'dotenv/config';

export const InitAI = () => {
  if (process.env.COHERE_APIKEY) {
    return new Cohere(process.env.COHERE_APIKEY);
  } else if (process.env.OPENAI_APIKEY) {
    return new OpenAI(process.env.OPENAI_APIKEY);
  } else if (process.env.TOGETHER_APIKEY) {
    return new Together(process.env.TOGETHER_APIKEY);
  } else if (process.env.ANTHROPIC_APIKEY) {
    return new Anthropic(process.env.ANTHROPIC_APIKEY);
  }
  throw new Error('No LLM API key found');
};

const ai = InitAI();

const result = {
  type: 'object',
  properties: {
    answer: { type: 'number' },
  },
  required: ['answer'],
};

const prompt = new SPrompt(result, [JSInterpreterFunction()]);
// prompt.setDebug(true);

const query = `
Calculate the fibonacci series of 10
`;

const res = await prompt.generate(ai, query);
console.log('>', res.value());
