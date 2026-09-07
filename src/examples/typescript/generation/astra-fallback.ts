// ax-example:start
// title: Background tool compatibility fallback
// group: generation
// description: The same background declaration works through the ordinary loop on a provider/model without sessions.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// ax-example:end
import { AxAIOpenAIModel, ai, ax, fn } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
  config: { model: AxAIOpenAIModel.GPT56Luna },
});
let calls = 0;
const lookup = fn('lookupCode')
  .description('Get the confirmation code')
  .execution('background')
  .handler(() => {
    calls++;
    return 'AX-742';
  })
  .build();
const result = await ax('question -> answer', { functions: [lookup] }).forward(
  llm,
  { question: 'Use lookupCode and report the confirmation code.' },
  {
    thinkingTokenBudget: 'none',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
);
if (calls !== 1 || !result.answer.includes('AX-742'))
  throw new Error(
    'Fallback did not execute and incorporate the tool exactly once'
  );
console.log(result.answer);
