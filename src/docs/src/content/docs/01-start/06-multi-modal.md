---
title: Multi-modal DSPy
description: Using multi-modal inputs like images and audio with DSPy pipelines and LLMs
---

When using models like `GPT-4o` and `Gemini` that support multi-modal prompts, we support using image fields, and this works with the whole DSP pipeline.

```typescript
const image = fs
  .readFileSync('./src/examples/assets/kitten.jpeg')
  .toString('base64');

const gen = new AxChainOfThought(`question, animalImage:image -> answer`);

const res = await gen.forward(ai, {
  question: 'What family does this animal belong to?',
  animalImage: { mimeType: 'image/jpeg', data: image }
});
```

When using models like `gpt-4o-audio-preview` that support multi-modal prompts with audio support, we support using audio fields, and this works with the whole DSP pipeline.

```typescript
const audio = fs
  .readFileSync('./src/examples/assets/comment.wav')
  .toString('base64');

const gen = new AxGen(`question, commentAudio:audio -> answer`);

const res = await gen.forward(ai, {
  question: 'What family does this animal belong to?',
  commentAudio: { format: 'wav', data: audio }
});
```