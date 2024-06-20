import { axAI, AxChainOfThought, type AxOpenAIArgs } from '../index.js';

const ai = axAI('openai', {
  apiKey: process.env.OPENAI_APIKEY
} as AxOpenAIArgs);

// const ai = axAI('google-gemini', {
//   apiKey: process.env.GOOGLE_APIKEY
// } as AxOpenAIArgs);

// setup the prompt program
const gen = new AxChainOfThought(
  ai,
  `startNumber:number -> next10Numbers:number[]`
);

// add a assertion to ensure that the number 5 is not in an output field
gen.addAssert(({ next10Numbers }: Readonly<{ next10Numbers: number[] }>) => {
  return next10Numbers ? !next10Numbers.includes(5) : undefined;
}, 'Numbers 5 is not allowed');

// run the program with streaming enabled
const res = await gen.forward(
  { startNumber: 1 },
  { stream: true, debug: true }
);

console.log('>', res);
