// ax-example:start
// title: TypeScript OpenAI Decisions
// group: generation
// description: Classifies tickets with described boolean and class outputs using OpenAI Decisions.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 44
// ax-example:end
import { ai, ax } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');
const model = ai({ name: 'openai-decisions', apiKey, trueThreshold: 0.9 });
const triage = ax(`
  ticket:string ->
  urgent:boolean(true "A core task is blocked", false "A routine request") "Does this need immediate attention?",
  team:class "support, billing, engineering"(
    support "Product usage questions",
    billing "Individual invoice or charge disputes",
    engineering "Broken functionality or service outages"
  ) "Which team should investigate?"
`);
const decision = await triage.forward(model, {
  ticket: 'Checkout fails for every customer. Payments cannot complete.',
});
if (
  typeof decision.urgent !== 'boolean' ||
  !['support', 'billing', 'engineering'].includes(decision.team)
) {
  throw new Error('Invalid decision result.');
}
console.log(decision);
console.log(
  triage.getChatLog().at(-1)?.providerMetadata?.openaiDecisions?.answers
);
