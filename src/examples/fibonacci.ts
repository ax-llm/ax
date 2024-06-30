import {
  AxAI,
  axJSInterpreterFunction,
  AxReAct,
  AxSignature
} from '../ax/index.js';

const sig = new AxSignature(
  `numberSeriesTask:string  -> fibonacciSeries:number[]`
);

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

const gen = new AxReAct(ai, sig, { functions: [axJSInterpreterFunction()] });

const res = await gen.forward({
  numberSeriesTask: 'Use code to calculate the fibonacci series of 10'
});

console.log('>', res);
