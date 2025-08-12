import { ai, ax } from '@ax-llm/ax';
import fs from 'node:fs';

const presentation = fs
  .readFileSync('./src/examples/assets/presentation.wav')
  .toString('base64');
const countdown = fs
  .readFileSync('./src/examples/assets/countdown.wav')
  .toString('base64');

const gen = ax('question:string, clips:audio[] -> answer:string');

const openai = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? '',
  config: { model: 'gpt-4o-audio-preview' } as any,
});

const openaiRes = await gen.forward(openai, {
  question: 'What are the audios about?',
  clips: [
    { format: 'wav', data: presentation },
    { format: 'wav', data: countdown },
  ],
});

console.log({ openai: openaiRes.answer });

const gemini = ai({
  name: 'google-gemini',
  apiKey: process.env.GEMINI_API_KEY ?? '',
  config: { model: 'gemini-2.5-flash' } as any,
});

const geminiRes = await gen.forward(gemini, {
  question: 'What are the audios about?',
  clips: [
    { format: 'wav', data: presentation },
    { format: 'wav', data: countdown },
  ],
});

console.log({ gemini: geminiRes.answer });
