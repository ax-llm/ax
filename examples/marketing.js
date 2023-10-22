import { MessagePrompt, MessageType } from 'llmclient';
import { Anthropic, Together, Cohere, OpenAI } from 'llmclient';

import 'dotenv/config';

const InitAI = () => {
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

const product = {
  name: 'Acme Toilet Cleaning',
  description: '24/7 Commercial and residential restroom cleaning services',
};

const to = {
  name: 'Jerry Doe',
  title: 'Head of facilities and operations',
  company: 'Blue Yonder Inc.',
};

// process.on("unhandledRejection", (error) => {
//   console.error(error); // This prints error with stack included (as for normal errors)
//   throw error; // Following best practices re-throw error and let the process exit with error code
// });

const prompt = new MessagePrompt({ type: MessageType.Text }, product, to);
prompt.setDebug(true);

const context = `
1. Under 160 characters
2. Prompts recipients to book an call
3. Employs emojis and friendly language
`;

try {
  const res = await prompt.generate(ai, context);
  console.log(res.value());
} catch (error) {
  console.dir(error)
}
