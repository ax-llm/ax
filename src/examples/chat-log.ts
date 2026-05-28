#!/usr/bin/env -S npx tsx
import { type AxFunction, ax, ai as createAI } from '@ax-llm/ax';

const ai = createAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

// Example 1: Simple forward — inspect full system prompt + user message + response
const gen = ax('question:string -> answer:string');

await gen.forward(ai, { question: 'What is the capital of France?' });

console.log(JSON.stringify(gen.getChatLog(), null, 2));

// Example 2: Multi-step with function calls
const getWeather = (args: { city: string }) =>
  JSON.stringify({ city: args.city, temp: '22°C', condition: 'sunny' });

const functions: AxFunction[] = [
  {
    name: 'getWeather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
    func: getWeather,
  },
];

const agentGen = ax('userRequest:string -> agentResponse:string', {
  functions,
});

await agentGen.forward(
  ai,
  { userRequest: "What's the weather in Paris and Tokyo?" },
  { maxSteps: 10 }
);

console.log(JSON.stringify(agentGen.getChatLog(), null, 2));

console.log(agentGen.getUsage());
