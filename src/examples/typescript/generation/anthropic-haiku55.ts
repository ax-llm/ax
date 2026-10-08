// ax-example:start
// title: Haiku 5.5 ticket classification
// group: generation
// description: Classify a support ticket with Haiku 5.5 and adaptive thinking at low effort.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: beginner
// ax-example:end
import { AxAIAnthropicModel, ai, ax } from '@ax-llm/ax';

const llm = ai({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_APIKEY,
  config: { model: AxAIAnthropicModel.Claude55Haiku },
});

const classify = ax(
  'ticket:string -> category:class "billing, technical, account"'
);
const result = await classify.forward(
  llm,
  { ticket: 'I was charged twice for my subscription this month.' },
  {
    thinkingTokenBudget: 'low',
    showThoughts: false,
    stream: false,
    abortSignal: AbortSignal.timeout(60_000),
  }
);

if (result.category !== 'billing') {
  throw new Error(`Expected billing, received ${result.category}`);
}
console.log(result.category);
