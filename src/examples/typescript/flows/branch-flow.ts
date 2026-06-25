// ax-example:start
// title: TypeScript Branching Flow
// group: flows
// description: Routes a classification through follow-up flow logic backed by OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
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

const workflow = flow<{ request: string }>()
  .description(
    'TypeScript Branching Flow',
    'Routes a classification through follow-up flow logic backed by OpenAI.'
  )
  .node(
    'classifier',
    'request:string -> route:class "support, sales, engineering"'
  )
  .node('responder', 'request:string, route:string -> response:string')
  .execute('classifier', (state) => ({ request: state.request }))
  .execute('responder', (state) => ({
    request: state.request,
    route: state.classifierResult.route,
  }))
  .returns((state) => ({
    route: state.classifierResult.route as string,
    response: state.responderResult.response as string,
  }));

const result = await workflow.forward(llm, {
  request: 'A customer says checkout is down for their enterprise account.',
});

console.log(JSON.stringify(result, null, 2));
