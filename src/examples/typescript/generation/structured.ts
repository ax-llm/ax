// ax-example:start
// title: TypeScript Structured Extraction
// group: generation
// description: Extracts structured fields and labels from support text with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import { AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
    temperature: 0,
  },
});

const program = ax(
  'ticket:string -> priority:class "high, normal, low", summary:string, labels:string[]'
);
const result = await program.forward(llm, {
  ticket:
    'Checkout has failed for enterprise customers since 09:00. Support wants a concise summary and tags.',
});

console.log(JSON.stringify(result, null, 2));
