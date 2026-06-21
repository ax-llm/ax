// ax-example:start
// title: TypeScript Audio Summary Pipeline
// group: audio
// description: Transcribes audio and summarizes the transcript with an OpenAI-backed generator.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import { readFileSync } from 'node:fs';
import { AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';

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
const summarize = ax('transcript:string -> summary:string, followUps:string[]');
const result = await summarize.forward(llm, { transcript: transcript.text });

console.log(JSON.stringify({ transcript: transcript.text, result }, null, 2));
