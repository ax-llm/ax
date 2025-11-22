import { AxAIAnthropic } from '../ax/ai/anthropic/api.js';
import { AxAIAnthropicModel } from '../ax/ai/anthropic/types.js';
import type { AxModelUsage } from '../ax/ai/types.js';

const ai = new AxAIAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_APIKEY || '',
  config: {
    model: AxAIAnthropicModel.Claude3Haiku,
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
  const result1 = await ai.chat(req);
  let usage1: AxModelUsage | undefined;
  if (result1 instanceof ReadableStream) {
    const reader = result1.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.modelUsage) {
          usage1 = value.modelUsage;
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    usage1 = result1.modelUsage;
  }
  console.log('Response 1 Usage:', usage1?.tokens);

  console.log('Sending request 2 (should hit cache)...');
  const result2 = await ai.chat(req);
  let usage2: AxModelUsage | undefined;
  if (result2 instanceof ReadableStream) {
    const reader = result2.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.modelUsage) {
          usage2 = value.modelUsage;
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    usage2 = result2.modelUsage;
  }
  console.log('Response 2 Usage:', usage2?.tokens);
}

run().catch(console.error);
