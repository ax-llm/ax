import {
  SPrompt,
  OpenAI,
  JSInterpreterFunction,
} from 'llmclient';

import 'dotenv/config';

const ai = new OpenAI({ apiKey: process.env.APIKEY });

const result = {
  type: 'object',
  properties: {
    answer: { type: 'number' },
  },
  required: ['answer'],
};

const prompt = new SPrompt(result, [JSInterpreterFunction()]);
// prompt.setDebug(true);

const query = `Use code to calculate the fibonacci series of 10`;

const res = await prompt.generate(ai, query, { functionCall: { name: "jsInterpreter" } });
console.log('>', res.value());
