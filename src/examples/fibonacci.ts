import { AxAI, AxGen, AxJSInterpreter, AxSignature } from '@ax-llm/ax'

const sig = new AxSignature(
  `numberSeriesTask:string  -> fibonacciSeries:number[]`
)

const gen = new AxGen<{ numberSeriesTask: string }>(sig, {
  functions: [new AxJSInterpreter()],
})

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
})

const res = await gen.forward(ai, {
  numberSeriesTask: 'Use code to calculate the fibonacci series of 10',
})

console.log('>', res)
