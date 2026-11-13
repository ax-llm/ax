// ax-example:start
// title: TypeScript Google Gemini Decisions
// group: generation
// description: Classify and score a support ticket with native probabilities and confidence.
// provider: google-gemini-decisions
// env: GOOGLE_APIKEY, GEMINI_API_KEY, GOOGLE_API_KEY
// level: intermediate
// order: 47
// ax-example:end
import { ai, ax } from '@ax-llm/ax';

const apiKey =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  process.env.GOOGLE_APIKEY;
if (!apiKey)
  throw new Error('Set GEMINI_API_KEY, GOOGLE_API_KEY or GOOGLE_APIKEY.');
const model = ai({ name: 'google-gemini-decisions', apiKey });
const triage = ax(`
  ticket:string ->
  urgent:boolean(evidence, threshold 0.9) "Does a core task fail for all customers?",
  team:class "support, billing, engineering"(evidence,
    support "Product usage questions",
    billing "Individual invoice disputes",
    engineering "Broken functionality or service outages"
  ) "Which team should investigate?",
  severity:score "Minor inconvenience, Feature impaired, Core task blocked"(evidence)
    "How severe is the customer impact?"
`);
const decision = await triage.forward(model, {
  ticket: 'Checkout fails for every customer. Payments cannot complete.',
});
console.log(decision);
