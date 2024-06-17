import {
  axAI,
  axJSInterpreterFunction,
  type AxOpenAIArgs,
  AxReAct,
  AxSignature
} from '../index.js';

const sig = new AxSignature(
  `numberSeriesTask:string  -> fibonacciSeries:number[]`
);

const ai = axAI('openai', {
  apiKey: process.env.OPENAI_APIKEY
} as AxOpenAIArgs);
const gen = new AxReAct(ai, sig, { functions: [axJSInterpreterFunction()] });
const res = await gen.forward({
  numberSeriesTask: 'Use code to calculate the fibonacci series of 10'
});

console.log('>', res);
