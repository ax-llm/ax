// ax-example:start
// title: TypeScript Text To Speech
// group: audio
// description: Generates speech audio through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 40
// ax-example:end
import { writeFileSync } from 'node:fs';
import { AxAIOpenAIModel, ai } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT54Mini,
    temperature: 0,
  },
});

const speech = await llm.speak({
  text: 'Ax turns LLM prompts into typed programs.',
  voice: 'alloy',
  format: 'mp3',
});

writeFileSync(
  './src/examples/output/public-openai-speech.mp3',
  Buffer.from(speech.data, 'base64')
);
console.log(
  JSON.stringify(
    { format: speech.format, transcript: speech.transcript },
    null,
    2
  )
);
