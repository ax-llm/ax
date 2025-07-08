import { AxAI, AxGen, AxJSInterpreter } from '@ax-llm/ax';

const gen = new AxGen<{ numberSeriesTask: string }>(
  {
    inputs: [{ name: 'numberSeriesTask', type: { name: 'string' } }],
    outputs: [
      { name: 'fibonacciSeries', type: { name: 'number', isArray: true } },
    ],
  },
  {
    functions: [new AxJSInterpreter()],
    debug: true,
  }
);

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { stream: true },
});

const res = await gen.forward(ai, {
  numberSeriesTask: 'Use code to calculate the fibonacci series of 10',
});

console.log('>', res);
