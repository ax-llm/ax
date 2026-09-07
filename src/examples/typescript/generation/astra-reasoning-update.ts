// ax-example:start
// title: Astra reasoning updates through a flow
// group: generation
// description: Propagate a reasoning update through the existing flow execution options.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// ax-example:end
import { AxAIOpenAIModel, ai, ax, flow, fn, runControl } from '@ax-llm/ax';

const control = runControl();
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
  config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 2000 },
});
const lookup = fn('lookupCode')
  .description('Look up the required confirmation code')
  .execution('background')
  .handler(async () => {
    control.setThinkingTokenBudget('high');
    control.steer(
      'Include the confirmation code verbatim and keep the answer brief.'
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return 'AX-742';
  })
  .build();
const workflow = flow<{ question: string }>()
  .node('delivery', ax('question -> answer', { functions: [lookup] }))
  .execute('delivery', (state) => ({ question: state.question }))
  .returns((state) => ({ answer: state.deliveryResult.answer }));
const result = await workflow.forward(
  llm,
  { question: 'Call lookupCode and report the confirmation code.' },
  {
    control,
    thinkingTokenBudget: 'low',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
);
if (!result.answer.includes('AX-742'))
  throw new Error('Flow did not incorporate the tool result');
console.log(result.answer);
