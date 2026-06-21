// ax-example:start
// title: TypeScript Speech To Text
// group: audio
// description: Transcribes a checked-in WAV file through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import { readFileSync } from 'node:fs';
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

const audio = readFileSync('./src/examples/assets/presentation.wav').toString(
  'base64'
);
const transcript = await llm.transcribe({
  audio: { data: audio, format: 'wav', filename: 'presentation.wav' },
  language: 'en',
});

console.log(JSON.stringify(transcript, null, 2));
