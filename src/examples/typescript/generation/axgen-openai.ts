// ax-example:start
// title: TypeScript Typed Generation
// group: generation
// description: Runs a small typed generation program against OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 10
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

const program = ax('question:string -> answer:string');
const result = await program.forward(llm, {
  question:
    'In one sentence, explain Ax as a language-agnostic LLM programming library.',
});

console.log(JSON.stringify(result, null, 2));
