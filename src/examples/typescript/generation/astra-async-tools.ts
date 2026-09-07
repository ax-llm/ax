// ax-example:start
// title: Automatic Astra background tools
// group: generation
// description: AxGen runs a declared-background tool and incorporates its result automatically.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// ax-example:end
import { AxAIOpenAIModel, ai, ax, fn, runControl } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
  config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 2000 },
});
const control = runControl();
let overlap = false;
let lookupPending = false;
let calculationOverlapped = false;
let lookupCalls = 0;
let calculationCalls = 0;
control.onEvent((event) => {
  if (event.type === 'model.output' && event.pendingCallIds?.length) {
    overlap = true;
  }
});
const calculate = fn('calculateEstimate')
  .description('Compute an independent estimate while delivery lookup runs')
  .execution('background')
  .handler(() => {
    calculationCalls++;
    calculationOverlapped ||= lookupPending;
    return 7 * 8;
  })
  .build();
const lookup = fn('lookupDelivery')
  .description(
    'Get the current delivery code. Call once; while it runs, reason about a concise customer update.'
  )
  .execution('background')
  .handler(async () => {
    lookupCalls++;
    lookupPending = true;
    console.log('Delivery lookup started');
    await new Promise((resolve) => setTimeout(resolve, 8000));
    lookupPending = false;
    console.log('Delivery lookup completed');
    return { deliveryCode: 'AX-742', status: 'arrives tomorrow' };
  })
  .build();
const result = await ax('question -> answer', {
  functions: [lookup, calculate],
}).forward(
  llm,
  {
    question:
      'Start lookupDelivery first, then call calculateEstimate while lookupDelivery is still running. Include the estimate and delivery code/status in the final answer.',
  },
  {
    control,
    thinkingTokenBudget: 'low',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
);
if (!['AX-742', '56', 'tomorrow'].every((text) => result.answer.includes(text)))
  throw new Error('Final answer omitted the tool result');
if (lookupCalls !== 1 || calculationCalls !== 1)
  throw new Error('A tool was not executed exactly once');
if (!overlap || !calculationOverlapped)
  throw new Error(
    'No independent model output observed while a tool was pending'
  );
console.log('Observed independent model work while a tool was pending');
console.log(result.answer);
