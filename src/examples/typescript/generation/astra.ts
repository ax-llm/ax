// ax-example:start
// title: GPT-6 Astra generation
// group: generation
// description: Generate a typed answer with GPT-6 Astra through Responses.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// ax-example:end
import { AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY,
  config: { model: AxAIOpenAIModel.GPT6Astra },
});
const answer = await ax('question:string -> answer:string').forward(
  llm,
  { question: 'Why do leaves change color in autumn?' },
  { thinkingTokenBudget: 'low', serviceTier: 'standard' }
);
console.log(answer);
