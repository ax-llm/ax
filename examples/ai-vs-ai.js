import { Cohere, OpenAI, Memory} from 'llmclient';

import 'dotenv/config';

import chalk from 'chalk';

const mem = new Memory(5)

const openAI = new OpenAI(process.env.OPENAI_APIKEY);
const cohere = new Cohere(process.env.COHERE_APIKEY);

// prompt.setDebug(true)

const system = `The following is a conversation with an AI assistant. The assistant is helpful, creative, clever, and very friendly.`

const start =
  'Hi OpenAI my name is Cohere. I was wondering if you know what the meaning of life is?';

mem.add({ role:"system", text: system})
mem.add({ role: "assistant", text: start })

for (let i = 0; i < 10; i++) {
  const res1 = await openAI.chat({ chatPrompt: mem.history() });
  mem.add(res1.results.at(0))

  const res2 = await cohere.chat({ chatPrompt: mem.history() });
  mem.add(res2.results.at(0))

  console.log(chalk.green('OpenAI: ', res1.results.at(0).text) + '\n');
  console.log(chalk.magenta('Cohere: ', res2.results.at(0).text) + '\n');
}
