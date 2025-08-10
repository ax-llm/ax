import { AxAIGrokModel, ai, ax } from '@ax-llm/ax';

export const webSearchGen = ax(
  'userQuestion:string "User question to answer using live web search" -> answerText:string "Direct answer text", sourceCitations:json "Provider citations/URLs if available"'
);

console.log('=== Grok Live Search Demo ===');

const llm = ai({
  name: 'grok',
  apiKey: process.env.GROK_API_KEY!,
  config: { model: AxAIGrokModel.Grok3, stream: false },
  options: {
    searchParameters: {
      mode: 'on',
      returnCitations: true,
      maxSearchResults: 5,
      sources: [{ type: 'web' }],
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
