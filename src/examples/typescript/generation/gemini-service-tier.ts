// ax-example:start
// title: Gemini Flex Inference
// group: generation
// description: Sends latency-tolerant work through Gemini Flex and reports the tier that handled it.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: intermediate
// order: 50
// ax-example:end
import { AxAIGoogleGeminiModel, ai } from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;
if (!apiKey) {
  throw new Error('Set GOOGLE_APIKEY to run this example.');
}

const gemini = ai({
  name: 'google-gemini',
  apiKey,
  config: {
    model: AxAIGoogleGeminiModel.Gemini37Flash,
  },
});

const result = await gemini.chat(
  {
    chatPrompt: [
      {
        role: 'user',
        content:
          'Summarize why batching independent evaluation work saves time.',
      },
    ],
  },
  { stream: false, serviceTier: 'flex' }
);

if (result instanceof ReadableStream) {
  throw new Error('Expected a non-streaming Gemini response.');
}

console.log(result.results[0]?.content);
console.log(
  `Handled by: ${result.modelUsage?.tokens?.serviceTier ?? 'unknown'}`
);
