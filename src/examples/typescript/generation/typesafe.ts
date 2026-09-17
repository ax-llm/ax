// ax-example:start
// title: TypeScript Typesafe Decisions
// group: generation
// description: Evaluates described boolean outcomes and categories with a configurable Typesafe threshold.
// provider: typesafe
// env: TYPESAFE_API_KEY, TYPESAFE_APIKEY
// level: beginner
// order: 43
// ax-example:end
import { ai, ax } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey)
  throw new Error(
    'Set TYPESAFE_API_KEY or TYPESAFE_APIKEY to run this example.'
  );

const model = ai({ name: 'typesafe', apiKey, trueThreshold: 0.9 });
const triage = ax(
  `ticket:string -> urgent:boolean(
    true "Customers cannot complete a core task",
    false "A routine request or minor inconvenience"
  ) "Does this need immediate attention?",
  team:class "support, billing, engineering"(
    support "Product usage questions",
    billing "Individual invoice or charge disputes",
    engineering "Broken functionality or service outages"
  ) "Which team should investigate?"`
);

const decision = await triage.forward(model, {
  ticket:
    'Checkout is returning errors for every customer. Payments cannot complete.',
});

console.log(decision);
console.log(triage.getChatLog().at(-1)?.providerMetadata?.typesafe?.answers);
