// ax-example:start
// title: TypeScript Typesafe Hybrid Triage
// group: generation
// description: Uses Typesafe for typed decisions, then a generative model for a summary based on those decisions.
// provider: typesafe, openai
// env: TYPESAFE_API_KEY, TYPESAFE_APIKEY, OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 44
// ax-example:end
import { AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';

const typesafeKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
const openaiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!typesafeKey || !openaiKey) {
  throw new Error(
    'Set TYPESAFE_API_KEY (or TYPESAFE_APIKEY) and OPENAI_API_KEY (or OPENAI_APIKEY) to run this example.'
  );
}

const typesafe = ai({
  name: 'typesafe',
  apiKey: typesafeKey,
  trueThreshold: 0.9,
});
const writer = ai({
  name: 'openai',
  apiKey: openaiKey,
  config: { model: AxAIOpenAIModel.GPT56Luna },
});

const ticket =
  'Checkout is returning errors for every customer. Payments cannot complete.';
const triage = ax(
  'ticket:string -> urgent:boolean, team:class "support, billing, engineering"'
);
const decision = await triage.forward(typesafe, { ticket });

const summarize = ax(
  'ticket:string, urgent:boolean, team:string -> summary:string "Brief internal summary based on the supplied triage decisions"'
);
const { summary } = await summarize.forward(writer, { ticket, ...decision });

console.log({ ...decision, summary });
