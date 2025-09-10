import { AxAIAnthropicModel, ai, ax } from '@ax-llm/ax';

export const askWithSearch = ax(
  'userQuestion:string "User question to answer using web search if needed" -> responseText:string "Assistant answer"'
);

console.log('=== Anthropic Web Search Tool Demo ===');

const llm = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_APIKEY!,
  config: {
    model: AxAIAnthropicModel.Claude37Sonnet,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
        user_location: {
          type: 'approximate',
          city: 'San Francisco',
          region: 'California',
          country: 'US',
          timezone: 'America/Los_Angeles',
        },
      },
    ],
  },
});

await askWithSearch.forward(
  llm,
  {
    userQuestion: 'Whats happening in the NFL right now in short',
  },
  {
    stream: true,
    debug: true,
  }
);
