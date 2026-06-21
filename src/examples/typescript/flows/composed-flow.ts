// ax-example:start
// title: TypeScript Composed Flow
// group: flows
// description: Composes multiple typed programs into one OpenAI-backed flow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import { AxAIOpenAIModel, ai, flow } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT54Mini,
    temperature: 0,
  },
});

const workflow = flow<{ topic: string }>()
  .description(
    'TypeScript Composed Flow',
    'Composes multiple typed programs into one OpenAI-backed flow.'
  )
  .node('outline', 'topic:string -> outline:string[]')
  .node('brief', 'topic:string, outline:string[] -> brief:string')
  .execute('outline', (state) => ({ topic: state.topic }))
  .execute('brief', (state) => ({
    topic: state.topic,
    outline: state.outlineResult.outline,
  }))
  .returns((state) => ({
    outline: state.outlineResult.outline as string[],
    brief: state.briefResult.brief as string,
  }));

const result = await workflow.forward(llm, {
  topic:
    'How Ax moves from typed generation to agents, flows, and optimization',
});

console.log(JSON.stringify(result, null, 2));
