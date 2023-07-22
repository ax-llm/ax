import { Memory, AssistantPrompt } from '@dosco/llm-client';
import { Anthropic, Together, Cohere, OpenAI } from '@dosco/llm-client';
import { createInterface } from 'readline';
import Bottleneck from 'bottleneck';

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

// Example of  a chat assistant with memory and an api rate limiter.

/*
❯ node chat-assistant.js
AI: How far is the sun from the moon?
> The sun is about 384,400 kilometers away from the moon.

AI: And from mars?
> The sun is about 384,400 kilometers away from Mars as well.

AI: will it ever end?
> The sun will eventually end, but not for billions of years.
*/

const ai = InitAI();

const mem = new Memory();
const prompt = new AssistantPrompt();
prompt.setDebug(true);

const bottleneck = new Bottleneck({
  maxConcurrent: 1, // Maximum number of requests running at the same time
  minTime: 200, // Minimum time between each request
});

let id = 0;

const rateLimiter = (fn) => {
  id++;
  return bottleneck.schedule({ id: `${id}` }, fn);
};

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
      const res = await prompt.generate(ai, line, { mem, rateLimiter });
      console.log(`> ${res.value()}\n`);
      break;
  }
  rl.prompt();
}).on('close', function () {
  console.log('Have a great day!');
  process.exit(0);
});
