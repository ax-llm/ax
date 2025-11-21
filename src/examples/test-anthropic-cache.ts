import { AxAIAnthropic } from '../ax/ai/anthropic/api.js';

const ai = new AxAIAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_APIKEY || '',
  config: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 1000,
    stream: true,
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
  const stream1 = await ai.chat(req);
  let usage1;
  for await (const chunk of stream1) {
    if (chunk.modelUsage) {
      usage1 = chunk.modelUsage;
    }
  }
  console.log('Response 1 Usage:', usage1?.tokens);

  console.log('Sending request 2 (should hit cache)...');
  const stream2 = await ai.chat(req);
  let usage2;
  for await (const chunk of stream2) {
    if (chunk.modelUsage) {
      usage2 = chunk.modelUsage;
    }
  }
  console.log('Response 2 Usage:', usage2?.tokens);
}

run().catch(console.error);
