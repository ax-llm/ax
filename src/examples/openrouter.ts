import { ai, ax } from '@ax-llm/ax';

export const openrouterGen = ax(
  'userQuestion:string "User question" -> responseText:string "AI response"'
);

console.log('=== OpenRouter Demo ===');

const llm = ai({
  name: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY!,
  referer: process.env.OPENROUTER_REFERER,
  title: process.env.OPENROUTER_TITLE,
  config: { model: 'openrouter/auto' },
});

const result = await openrouterGen.forward(llm, {
  userQuestion: 'Say hello in one short sentence.',
});

console.log(result.responseText);
