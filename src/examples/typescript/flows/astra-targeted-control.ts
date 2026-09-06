// ax-example:start
// title: Astra targeted flow updates
// group: flows
// description: Change the review node's instructions and reasoning without rerunning a completed baseline node.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// ax-example:end
import { AxAIOpenAIModel, ai, ax, flow, fn, runControl } from '@ax-llm/ax';

const control = runControl();
const appliedPaths: string[] = [];
control.onEvent((event) => {
  if (event.type === 'applied') appliedPaths.push(event.path);
});
let baselineCalls = 0;
let reviewCalls = 0;
const baseline = fn('lookupBaseline')
  .description('Get the baseline reference; call once.')
  .execution('background')
  .handler(() => {
    baselineCalls++;
    return 'BASE-101';
  })
  .build();
const review = fn('lookupVerification')
  .description('Get the verification reference; call once.')
  .execution('background')
  .handler(() => {
    reviewCalls++;
    return 'CHECK-202';
  })
  .build();
const workflow = flow<{ question: string }>()
  .node('baseline', ax('question -> answer', { functions: [baseline] }))
  .node('review', ax('question -> answer', { functions: [review] }))
  .execute('baseline', (state) => ({ question: state.question }))
  .execute('review', (state) => {
    control.steer(
      'Include both exact references and the word REVIEWED in the final answer.',
      { target: 'root/review' }
    );
    control.setThinkingTokenBudget('medium', { target: 'root/review' });
    return {
      question: `Use lookupVerification to review this baseline: ${state.baselineResult.answer}`,
    };
  })
  .returns((state) => ({
    baseline: state.baselineResult.answer,
    review: state.reviewResult.answer,
  }));
const result = await workflow.forward(
  ai({
    name: 'openai',
    apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
    config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 2000 },
  }),
  { question: 'Call lookupBaseline and report its exact reference.' },
  {
    control,
    thinkingTokenBudget: 'low',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
);
if (baselineCalls !== 1 || reviewCalls !== 1)
  throw new Error('A completed node was rerun or a tool was skipped');
if (
  appliedPaths.length !== 2 ||
  appliedPaths.some((path) => path !== 'root/review')
)
  throw new Error('Updates were applied outside the review scope');
if (
  !['BASE-101', 'CHECK-202', 'REVIEWED'].every((text) =>
    result.review.includes(text)
  ) ||
  result.baseline.includes('REVIEWED')
)
  throw new Error('Targeted instructions were not isolated or incorporated');
console.log(result);
