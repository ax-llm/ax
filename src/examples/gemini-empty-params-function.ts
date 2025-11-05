import { AxAIGoogleGeminiModel, ai, ax } from '@ax-llm/ax';

export const gen = ax(
  'userQuestion:string "You must call the pingService and then the getSecretWord function to answer." -> assistantResponse:string "Final answer after calling the function"',
  {
    functions: [
      {
        name: 'pingService',
        description: 'Ping the service and return OK',
        func: async (args: Readonly<{ dummy: string }>) => {
          console.log('pingService called:', args);
        },
      },
      {
        name: 'getSecretWord',
        description: 'Get a random secret word',
        func: async () => {
          return 'secret';
        },
      },
    ],
  }
);

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.GeminiFlashLatest, stream: true },
});

const res = await gen.forward(llm, {
  userQuestion: 'Please check system health.',
});

console.log(res.assistantResponse);
