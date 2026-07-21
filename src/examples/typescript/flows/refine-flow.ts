// ax-example:start
// title: TypeScript Refinement Flow
// group: flows
// description: Drafts, critiques, and revises an answer through three OpenAI-backed nodes.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
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
    'TypeScript Refinement Flow',
    'A linear draft, critique, and revision pipeline.'
  )
  .node('draft', 'topicText:string -> draftText:string(max 500)')
  .node('critique', 'draftText:string -> critiqueText:string(max 250)')
  .node(
    'revise',
    'draftText:string, critiqueText:string -> revisedText:string(max 800)'
  )
  .execute('draft', (state) => ({ topicText: state.topicText }))
  .execute('critique', (state) => ({
    draftText: state.draftResult.draftText,
  }))
  .execute('revise', (state) => ({
    draftText: state.draftResult.draftText,
    critiqueText: state.critiqueResult.critiqueText,
  }))
  .returns((state) => ({ revisedText: state.reviseResult.revisedText }));

const result = await workflow.forward(llm, {
  topicText: 'Explain automatic flow parallelism to a backend engineer.',
});

console.log(JSON.stringify(result, null, 2));
