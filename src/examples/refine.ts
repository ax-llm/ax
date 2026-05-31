import { AxAIGoogleGeminiModel, ax, ai as createAI, refine } from '@ax-llm/ax';

const llm = createAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

const writer = ax(
  'topic:string -> title:string, outline:string[], opening:string'
);
writer.setInstruction(
  'Write a practical developer article opener with a specific title, a tight outline, and a direct first paragraph.'
);

const improved = refine(writer, {
  rounds: 3,
  samplesPerRound: 2,
  threshold: 0.85,
  rewardDescription:
    'Prefer specific titles, at least four outline items, and an opening paragraph over 140 characters.',
  rewardFn: ({ prediction }) => {
    const titleScore = prediction.title.length > 24 ? 0.25 : 0;
    const outlineScore =
      Math.min((prediction.outline?.length ?? 0) / 4, 1) * 0.35;
    const openingScore = Math.min(prediction.opening.length / 140, 1) * 0.4;
    return titleScore + outlineScore + openingScore;
  },
});

const result = await improved.forward(llm, {
  topic: 'using typed AI programs in production TypeScript services',
});

console.log(result);
console.log(
  improved
    .getAttempts()
    .map(({ round, sampleIndex, reward, adviceApplied }) => ({
      round,
      sampleIndex,
      reward,
      adviceApplied,
    }))
);
