import {
  Cohere,
  OpenAI,
  AlephAlpha,
  Memory,
  GenerateText,
  AssistantPrompt,
} from '@dosco/minds';
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

let ai;

if (process.env.COHERE_APIKEY) {
  ai = new Cohere(process.env.COHERE_APIKEY);
} else if (process.env.ALEPHALPHA_APIKEY) {
  ai = new AlephAlpha(process.env.ALEPHALPHA_APIKEY);
} else {
  ai = new OpenAI(process.env.OPENAI_APIKEY);
}

const mem = new Memory();
const prompt = new AssistantPrompt();
const gen = new GenerateText(ai, mem);
gen.setDebug(true);

const rl = createInterface(process.stdin, process.stdout);
rl.setPrompt('AI: ');
rl.prompt();

rl.on('line', async function (line) {
  switch (line.trim()) {
    case '':
      break;
    case 'bye':
      rl.close();
      return;
    default:
      const res = await gen.generate(line, prompt);
      console.log(`> ${res.value()}\n`);
      break;
  }
  rl.prompt();
}).on('close', function () {
  console.log('Have a great day!');
  process.exit(0);
});
