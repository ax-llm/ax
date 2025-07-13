import { AxAI, ax, f } from '@ax-llm/ax';
import { AxJSInterpreter } from '@ax-llm/ax-tools';

const gen = ax`
  numberSeriesTask:${f.string('Task to calculate number series')} -> 
  fibonacciSeries:${f.array(f.number())}
`;

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { stream: true },
});

const res = await gen.forward(
  ai,
  {
    numberSeriesTask: 'Use code to calculate the fibonacci series of 10',
  },
  {
    functions: [new AxJSInterpreter().toFunction()],
    debug: true,
  }
);

console.log('>', res);
