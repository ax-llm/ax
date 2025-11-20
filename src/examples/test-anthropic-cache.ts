import { AxAIAnthropic } from '../ax/ai/anthropic/api.js';
import type { AxChatResponse } from '../ax/ai/types.js';

const ai = new AxAIAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_APIKEY || '',
  config: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 1000,
    stream: false,
  },
});

const text = 'The quick brown fox jumps over the lazy dog. '.repeat(200);

const req = {
  chatPrompt: [
    {
      role: 'system' as const,
      content: 'You are a helpful assistant.',
      cache: true,
    },
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: text,
          cache: true,
        },
      ],
    },
  ],
};

async function run() {
  console.log('Sending request 1...');
  const res1 = (await ai.chat(req)) as AxChatResponse;
  console.log('Response 1:', JSON.stringify(res1, null, 2));
  console.log('Response 1 Usage:', res1.modelUsage?.tokens);

  console.log('Sending request 2 (should hit cache)...');
  const res2 = (await ai.chat(req)) as AxChatResponse;
  console.log('Response 2:', JSON.stringify(res2, null, 2));
  console.log('Response 2 Usage:', res2.modelUsage?.tokens);
}

run().catch(console.error);
