import {
  Cohere,
  OpenAI,
  Memory,
  GenerateText,
  AssistantPrompt,
} from '@dosco/minds';

import chalk from 'chalk';
import { createInterface } from 'readline';

/*
❯ node chat-assistant.js
AI: How far is the sun from the moon?
> The sun is about 384,400 kilometers away from the moon.

AI: And from mars?
> The sun is about 384,400 kilometers away from Mars as well.

AI: will it ever end?
> The sun will eventually end, but not for billions of years.
*/

const mem1 = new Memory();
const mem2 = new Memory();

const openAI = new GenerateText(new OpenAI(process.env.OPENAI_APIKEY), mem1);
const cohere = new GenerateText(new Cohere(process.env.COHERE_APIKEY), mem2);

// gen.setDebug(true)

const prompt = new AssistantPrompt();

const start =
  'Hi OpenAI my name is Cohere. I was wondering if you know what the meaning of life is?';

let openAIRes = await openAI.generate(start, prompt);
let cohereRes = await cohere.generate(openAIRes.value, prompt);

for (let i = 0; i < 3; i++) {
  console.log(chalk.green('OpenAI: ', openAIRes.value) + '\n');
  console.log(chalk.magenta('Cohere: ', cohereRes.value) + '\n');

  openAIRes = await openAI.generate(cohereRes.value, prompt);
  cohereRes = await cohere.generate(openAIRes.value, prompt);
}
