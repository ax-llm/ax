import { type AxFunction, ai, ax } from '@ax-llm/ax';

export const stopFnDemo = ax(
  'userQuestion:string "Instruction for the assistant" -> responseText:string "Assistant response"'
);

console.log('=== Stop Function Demo ===');

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

const functions: AxFunction[] = [
  {
    name: 'getCurrentTime',
    description: 'Returns the current time as an ISO string',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'The timezone to use for the current time',
        },
      },
      required: ['timezone'],
    },
    func: () => new Date().toISOString(),
  },
];

const result = await stopFnDemo.forward(
  llm,
  {
    userQuestion:
      'Call the getCurrentTime tool once each for asia and tokyo, then stop. Do not add extra commentary',
  },
  {
    functions,
    stopFunction: ['getCurrentTime'],
  }
);

console.log(result.responseText);
