// ax-example:start
// title: Cancel pending Astra flow tools
// group: flows
// description: Abort two parallel lookups through runControl and verify that the flow does not report successful completion.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// ax-example:end
import { AxAIOpenAIModel, ai, ax, flow, fn, runControl } from '@ax-llm/ax';

const control = runControl();
let started = 0;
let cancelled = 0;
let completed = false;
control.onEvent((event) => {
  if (event.type === 'completed' && event.path === 'root') completed = true;
});
const pendingLookup = () =>
  fn('lookup')
    .description('Start the required lookup. Call exactly once.')
    .execution('background')
    .handler(async (_args, extra) => {
      const signal = extra?.abortSignal;
      if (!signal) throw new Error('Tool did not receive cancellation context');
      signal.throwIfAborted();
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            cancelled++;
            reject(signal.reason);
          },
          { once: true }
        );
        started++;
        // Simulate a user pressing Stop after both lookups have begun.
        if (started === 2) control.abort();
      });
      return 'unreachable';
    })
    .build();
const workflow = flow<{ question: string }>()
  .node('left', ax('question -> answer', { functions: [pendingLookup()] }))
  .node('right', ax('question -> answer', { functions: [pendingLookup()] }))
  .execute('left', (state) => ({ question: state.question }))
  .execute('right', (state) => ({ question: state.question }))
  .returns((state) => ({
    answers: [state.leftResult.answer, state.rightResult.answer],
  }));

let rejected = false;
try {
  await workflow.forward(
    ai({
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
      config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 1500 },
    }),
    { question: 'Call lookup to obtain the required reference.' },
    {
      control,
      thinkingTokenBudget: 'low',
      serviceTier: 'standard',
      abortSignal: AbortSignal.timeout(120_000),
    }
  );
} catch (error) {
  if (!control.signal.aborted) throw error;
  rejected = true;
}
if (!rejected || started !== 2 || cancelled !== 2 || completed)
  throw new Error('Cancellation did not stop both pending branches');
console.log(
  'Cancelled both pending lookups; the flow did not report completion.'
);
