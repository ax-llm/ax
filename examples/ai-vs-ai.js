import { Cohere, OpenAI, Memory, AssistantPrompt } from '@dosco/llm-client';

import chalk from 'chalk';
import { createInterface } from 'readline';

const mem1 = new Memory();
const mem2 = new Memory();

const aiOpenAI = new OpenAI(process.env.OPENAI_APIKEY);
const aiCoHere = new Cohere(process.env.COHERE_APIKEY);

const prompt = new AssistantPrompt();
// prompt.setDebug(true)

const start =
  'Hi OpenAI my name is Cohere. I was wondering if you know what the meaning of life is?';

let openAIRes = await prompt.generate(aiOpenAI, start, { mem1 });
let cohereRes = await prompt.generate(aiCoHere, openAIRes.value, { mem2 });

for (let i = 0; i < 3; i++) {
  console.log(chalk.green('OpenAI: ', openAIRes.value()) + '\n');
  console.log(chalk.magenta('Cohere: ', cohereRes.value()) + '\n');

  openAIRes = await openAI.generate(cohereRes.value(), prompt);
  cohereRes = await cohere.generate(openAIRes.value(), prompt);
}
