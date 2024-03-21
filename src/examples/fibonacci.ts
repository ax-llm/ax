import {
  AI,
  JSInterpreterFunction,
  type OpenAIArgs,
  ReAct,
  Signature
} from '../index.js';

const sig = new Signature(
  `numberSeriesTask:string  -> fibonacciSeries:number[]`
);

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);
const gen = new ReAct(ai, sig, { functions: [JSInterpreterFunction()] });
const res = await gen.forward({
  numberSeriesTask: 'Use code to calculate the fibonacci series of 10'
});

console.log('>', res);
