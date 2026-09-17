// ax-example:start
// title: TypeScript Described Boolean and Class Values
// group: generation
// description: Runs one signature with Typesafe criteria and OpenAI text descriptions.
// provider: typesafe, openai
// env: TYPESAFE_API_KEY, TYPESAFE_APIKEY, OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
import assert from 'node:assert/strict';
import { AxAIOpenAIModel, ai, ax } from '@ax-llm/ax';

const typesafeKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
const openaiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!typesafeKey || !openaiKey)
  throw new Error('Set Typesafe and OpenAI API keys to run this example.');

const triage = ax(`
  ticket:string ->
  urgent:boolean(
    true "Customers cannot complete a core task",
    false "A routine request or minor inconvenience"
  ) "Does this need immediate attention?",
  team:class "support, billing, engineering"(
    support "Product usage questions",
    billing "Individual invoice or charge disputes",
    engineering "Broken functionality or service outages"
  ) "Which team should investigate?"
`);

const providers = [
  ai({ name: 'typesafe', apiKey: typesafeKey, trueThreshold: 0.9 }),
  ai({
    name: 'openai',
    apiKey: openaiKey,
    config: { model: AxAIOpenAIModel.GPT56Luna },
  }),
];

for (const model of providers) {
  const decision = await triage.forward(model, {
    ticket:
      'Checkout returns errors for every customer. Payments cannot complete.',
  });
  assert.equal(typeof decision.urgent, 'boolean');
  assert.ok(['support', 'billing', 'engineering'].includes(decision.team));
  console.log(model.getName(), decision);
}
