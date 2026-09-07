import { AxAIMetaModel, ai } from '@ax-llm/ax';

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error('Set MODEL_API_KEY');

const spark = ai({
  name: 'meta',
  apiKey,
  config: { model: AxAIMetaModel.MuseSpark13, stream: false },
});

const answer = await spark.chat(
  {
    chatPrompt: [
      {
        role: 'user',
        content: 'Give me three concise names for a solar-powered sailboat.',
        cache: true,
      },
    ],
  },
  { thinkingTokenBudget: 'highest', showThoughts: true }
);

if (answer instanceof ReadableStream) throw new Error('Expected one response');
console.log(answer.results[0]?.content);

if (process.argv.includes('--image')) {
  const image = ai({
    name: 'meta',
    apiKey,
    config: {
      model: AxAIMetaModel.MuseImage10,
      stream: false,
      imageGeneration: { size: '1024x1024', outputFormat: 'png' },
    },
  });

  const generated = await image.chat({
    chatPrompt: [
      {
        role: 'user',
        content: 'A solar-powered sailboat at sunrise, editorial illustration',
      },
    ],
  });

  if (generated instanceof ReadableStream) {
    throw new Error('Expected one response');
  }
  console.log(generated.results[0]?.images);
}
