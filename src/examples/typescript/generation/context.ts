// ax-example:start
// title: TypeScript Contextual Generation
// group: generation
// description: Answers from supplied context and returns compact citations with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
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
    model: AxAIOpenAIModel.GPT54Mini,
    temperature: 0,
  },
});

const program = ax(
  'context:string, question:string -> answer:string, citations:string[]'
);
const result = await program.forward(llm, {
  context:
    'Ax uses signatures for typed IO, ai() for providers, ax() for generation, agent() for runtime loops, flow() for orchestration, and optimize() for GEPA tuning.',
  question: 'How should a new developer think about Ax?',
});

console.log(JSON.stringify(result, null, 2));
