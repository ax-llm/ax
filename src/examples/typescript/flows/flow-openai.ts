// ax-example:start
// title: TypeScript Sequential Flow
// group: flows
// description: Runs a two-step Ax flow against OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 30
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

const workflow = flow<{ documentText: string }>()
  .description(
    'TypeScript Sequential Flow',
    'Runs a two-step Ax flow against OpenAI.'
  )
  .node('summarizer', 'documentText:string -> summaryText:string')
  .node(
    'classifier',
    'textContent:string -> priority:class "high, normal, low"'
  )
  .execute('summarizer', (state) => ({ documentText: state.documentText }))
  .execute('classifier', (state) => ({
    textContent: state.summarizerResult.summaryText,
  }))
  .returns((state) => ({
    summary: state.summarizerResult.summaryText as string,
    priority: state.classifierResult.priority as string,
  }));

const result = await workflow.forward(llm, {
  documentText:
    'Ax gives developers typed signatures, provider clients, agents, flows, tracing, and optimization so LLM features can be built as ordinary programs.',
});

console.log(JSON.stringify(result, null, 2));
