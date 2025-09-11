import { AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';
import { AxJSInterpreter } from '@ax-llm/ax-tools';

const gen = ax(
  'numberSeriesTask:string "Task to calculate number series" -> fibonacciSeries:number[] "Fibonacci series as an array of numbers"'
);

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: {
    model: AxAIOpenAIModel.GPT5Nano,
    stream: true,
    thinking: { thinkingTokenBudget: 0 },
  },
});

const res = await gen.forward(
  llm,
  {
    numberSeriesTask: 'Use code to calculate the fibonacci series of 10',
  },
  {
    functions: [new AxJSInterpreter().toFunction()],
    debug: true,
  }
);

console.log('>', res);
