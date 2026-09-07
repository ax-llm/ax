// ax-example:start
// title: Astra agent background tools
// group: short-agents
// description: Invoke a declared-background tool through the agent actor and shared AxAI session.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// ax-example:end
import {
  AxAIOpenAIModel,
  AxJSRuntime,
  agent,
  ai,
  fn,
  runControl,
} from '@ax-llm/ax';

const control = runControl();
let nativeCalls = 0;
control.onEvent((event) => {
  if (event.type === 'tool.started') nativeCalls++;
});
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
  config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 2500 },
});
const lookup = fn('lookupDelivery')
  .description('Look up the delivery confirmation')
  .execution('background')
  .handler(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { code: 'AX-742', status: 'arrives tomorrow' };
  })
  .build();
const assistant = agent('question -> answer', {
  runtime: new AxJSRuntime(),
  functions: [lookup],
});
const result = await assistant.forward(
  llm,
  {
    question:
      'Use lookupDelivery and report the exact confirmation code and delivery status.',
  },
  {
    control,
    thinkingTokenBudget: 'low',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
);
if (nativeCalls !== 1)
  throw new Error(
    `Expected one native background call; observed ${nativeCalls}`
  );
if (!result.answer.includes('AX-742'))
  throw new Error('Agent did not incorporate the tool result');
console.log(result.answer);
