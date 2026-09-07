// ax-example:start
// title: Astra tools and controls in one session
// group: generation
// description: Combine out-of-order background results, steering, and a reasoning update through AxGen.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// ax-example:end
import { AxAIOpenAIModel, ai, ax, fn, runControl } from '@ax-llm/ax';
import WebSocket from 'ws';

const control = runControl();
const completed: string[] = [];
const counts = { slow: 0, fast: 0 };
let slowPending = false;
let overlap = false;
control.onEvent((event) => {
  if (event.type === 'applied') console.log(`Update applied: ${event.timing}`);
});
const slow = fn('lookupSlowCode')
  .description('Get the slow code. Call exactly once, before lookupFastCode.')
  .execution('background')
  .handler(async () => {
    counts.slow++;
    slowPending = true;
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    slowPending = false;
    completed.push('slow');
    return 'SLOW-42';
  })
  .build();
const fast = fn('lookupFastCode')
  .description(
    'Get the independent fast code. Call exactly once while lookupSlowCode runs.'
  )
  .execution('background')
  .handler(async () => {
    counts.fast++;
    overlap ||= slowPending;
    control.steer('Report both exact codes and end the answer with Confirmed.');
    control.setThinkingTokenBudget('medium');
    await new Promise((resolve) => setTimeout(resolve, 100));
    control.steer(
      'Also include the word VERIFIED, while retaining both exact codes and ending with Confirmed.'
    );
    completed.push('fast');
    return 'FAST-17';
  })
  .build();
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
  config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 2500 },
  options: { webSocket: WebSocket },
});
const result = await ax('question -> answer', {
  functions: [slow, fast],
}).forward(
  llm,
  {
    question:
      'Start lookupSlowCode, then immediately call lookupFastCode while the slow lookup runs. Use both results in a short final answer.',
  },
  {
    control,
    thinkingTokenBudget: 'low',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
);
if (!overlap || completed.join(',') !== 'fast,slow')
  throw new Error('Expected independent, out-of-order tool completion');
if (counts.fast !== 1 || counts.slow !== 1)
  throw new Error('A tool was executed more than once');
if (
  !['FAST-17', 'SLOW-42', 'Confirmed', 'VERIFIED'].every((text) =>
    result.answer.includes(text)
  )
)
  throw new Error('Final answer omitted a result or the steering instruction');
console.log(`Completed tools: ${completed.join(', ')}`);
console.log(result.answer);
