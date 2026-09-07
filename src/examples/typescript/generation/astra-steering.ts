// ax-example:start
// title: Astra steering through AxGen
// group: generation
// description: Change a running generation using the shared run controller.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// ax-example:end
import { AxAIOpenAIModel, ai, ax, runControl } from '@ax-llm/ax';
import WebSocket from 'ws';

const control = runControl();
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
  config: { model: AxAIOpenAIModel.GPT6Astra, maxTokens: 2500 },
  options: { webSocket: WebSocket },
});
let steered = false;
control.onEvent((event) => {
  if (event.type === 'model.output' && !steered) {
    steered = true;
    control.steer(
      'Change the plan: use exactly three short bullet points and include the phrase Small launch.'
    );
  }
  if (event.type === 'applied')
    console.log(`Steering applied: ${event.timing}`);
});
let answer = '';
let version = -1;
for await (const chunk of ax('question -> answer').streamingForward(
  llm,
  {
    question:
      'Write a detailed ten-step launch plan for a task tracking application.',
  },
  {
    control,
    thinkingTokenBudget: 'low',
    serviceTier: 'standard',
    abortSignal: AbortSignal.timeout(120_000),
  }
)) {
  if (chunk.version !== version) {
    answer = '';
    version = chunk.version;
  }
  answer += chunk.delta.answer ?? '';
}
if (!steered || !answer.includes('Small launch'))
  throw new Error('Steering was not reflected in the final answer');
console.log(answer);
