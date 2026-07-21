// ax-example:start
// title: TypeScript Parallel Flow
// group: flows
// description: Runs two independent OpenAI-backed steps in parallel before joining their results.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
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

const workflow = flow<{ topicText: string }>()
  .description(
    'TypeScript Parallel Flow',
    'Research and audience analysis run independently before the join step.'
  )
  .node('research', 'topicText:string -> factList:string[]')
  .node('audience', 'topicText:string -> audienceAngle:string')
  .node(
    'join',
    'factList:string[], audienceAngle:string -> briefText:string(max 500)'
  )
  .execute('research', (state) => ({ topicText: state.topicText }))
  .execute('audience', (state) => ({ topicText: state.topicText }))
  .execute('join', (state) => ({
    factList: state.researchResult.factList,
    audienceAngle: state.audienceResult.audienceAngle,
  }))
  .returns((state) => ({ briefText: state.joinResult.briefText }));

const result = await workflow.forward(llm, {
  topicText:
    'Why typed contracts make multi-step LLM systems easier to maintain',
});

console.log(JSON.stringify(result, null, 2));
