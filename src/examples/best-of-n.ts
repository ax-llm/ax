import { AxAIGoogleGeminiModel, ax, bestOfN, ai as createAI } from '@ax-llm/ax';

const llm = createAI({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY as string,
  config: { model: AxAIGoogleGeminiModel.Gemini20FlashLite },
});

const answerer = ax(
  'question:string -> answer:string, confidence:number, rationale:string'
);
answerer.setInstruction(
  'Answer directly. Provide confidence as a number from 0 to 1 and rationale as one short sentence.'
);

const checked = bestOfN(answerer, {
  n: 4,
  threshold: 0.9,
  rewardFn: ({ prediction }) => {
    const confidence = prediction.confidence ?? 0;
    const rationaleScore = Math.min(prediction.rationale.length / 80, 1);
    return Math.min(1, confidence) * 0.75 + rationaleScore * 0.25;
  },
});

const result = await checked.forward(llm, {
  question: 'What makes TypeScript useful for large codebases?',
});

console.log(result);
console.log(
  checked.getAttempts().map(({ attempt, reward, metThreshold }) => ({
    attempt,
    reward,
    metThreshold,
  }))
);
