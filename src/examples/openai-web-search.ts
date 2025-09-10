import { AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';

export const webSearchGen = ax(
  'userQuestion:string "User question to answer using live web search" -> answerText:string "Direct answer text", sourceCitations:json "Provider citations/URLs if available"'
);

console.log('=== OpenAI Web Search Demo ===');

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  config: {
    model: AxAIOpenAIModel.GPT5Mini,
    stream: false,
    webSearchOptions: {
      searchContextSize: 'medium',
      userLocation: {
        approximate: {
          type: 'approximate',
          city: 'San Francisco',
          region: 'California',
          country: 'US',
          timezone: 'America/Los_Angeles',
        },
      },
    },
  },
});

const result = await webSearchGen.forward(llm, {
  userQuestion:
    'What are the latest developments in fusion energy research this week?',
});

console.log(result.answerText);
if (result.sourceCitations) {
  console.log(JSON.stringify(result.sourceCitations, null, 2));
}
