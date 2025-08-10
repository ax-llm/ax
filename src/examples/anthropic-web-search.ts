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
        allowed_domains: ['wikipedia.org', 'docs.anthropic.com'],
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

const result = await askWithSearch.forward(llm, {
  userQuestion:
    'When was Claude Shannon born? Provide a concise answer and include citations.',
});

console.log(result.responseText);
