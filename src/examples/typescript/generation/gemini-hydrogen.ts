// ax-example:start
// title: Gemini 4 Hydrogen
// group: generation
// description: Uses Hydrogen with a thinking level and an explicit output limit.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: beginner
// order: 51
// ax-example:end
import { AxAIGoogleGeminiModel, ai, ax } from '@ax-llm/ax';

const apiKey = process.env.GOOGLE_APIKEY;
if (!apiKey) throw new Error('Set GOOGLE_APIKEY to run this example.');

const llm = ai({
  name: 'google-gemini',
  apiKey,
  config: { model: AxAIGoogleGeminiModel.Gemini4Hydrogen, maxTokens: 4096 },
});
const explain = ax('question -> answer');
const result = await explain.forward(
  llm,
  { question: 'Why does a hash table usually provide fast lookups?' },
  // Use 'highest' for Hydrogen's xhigh level; 'low' keeps this example quick.
  { thinkingTokenBudget: 'low' }
);
console.log(result.answer);
