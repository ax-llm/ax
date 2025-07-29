import { ai, ax } from '@ax-llm/ax';

const values = {
  question: 'What is the weather like in tokyo?',
};

const functions = [
  {
    name: 'getCurrentWeather',
    description: 'get the current weather for a location',
    parameters: {
      type: 'object' as const,
      properties: {
        location: {
          type: 'string',
          description: 'location to get weather for',
        },
        units: {
          type: 'string',
          enum: ['imperial', 'metric'],
          default: 'imperial',
          description: 'units to use',
        },
      },
      required: ['location'],
    },

    func: async (args: Readonly<{ location: string; units: string }>) => {
      return `The weather in ${args.location} is 72 degrees`;
    },
  },
];

const gen = ax('question:string -> answer:string', {
  functions,
});

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

const res = await gen.forward(llm, values);
console.log(res);
