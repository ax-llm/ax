// ax-example:start
// title: TypeScript Typesafe Native Questions
// group: generation
// description: Uses structured state, rich criteria, native scoring, and explicit probability-based decisions.
// provider: typesafe
// env: TYPESAFE_API_KEY, TYPESAFE_APIKEY
// level: intermediate
// order: 45
// ax-example:end
import { typesafe } from '@ax-llm/ax';

const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_APIKEY;
if (!apiKey)
  throw new Error(
    'Set TYPESAFE_API_KEY or TYPESAFE_APIKEY to run this example.'
  );

const client = typesafe({ apiKey });
const result = await client.systemOne({
  state: {
    ticket: {
      text: 'Checkout returns errors for every customer. Payments cannot complete.',
      affectedFeature: 'payments',
    },
    recentEvents: ['Checkout deployment completed', 'Payment errors increased'],
  },
  questions: {
    urgent: {
      type: 'noul',
      instructions: 'Does this require immediate incident response?',
      criteria: {
        true: {
          description: 'Customers cannot complete a core task',
          examples: ['Payments are unavailable'],
        },
        false: 'A routine request or minor inconvenience',
      },
    },
    team: {
      type: 'choice',
      instructions: 'Which team should investigate?',
      criteria: {
        support: 'Product usage questions',
        billing: 'Individual invoice or charge disputes',
        engineering: 'Broken functionality or service outages',
      },
    },
    severity: {
      type: 'score',
      instructions: 'How severe is the customer impact?',
      criteria: [
        'Minor inconvenience with a workaround',
        'A core feature is impaired for some customers',
        'A core feature is unavailable for all customers',
      ],
    },
  },
});

// These are application policies. Native Noul and Score results remain unchanged.
const escalate = result.answers.urgent.noul >= 0.9;
const severity = result.answers.severity.score; // Fractional rubric position, 0–2.
const models = await client.listModels();
console.log({
  escalate,
  severity,
  answers: result.answers,
  usage: result.usage,
});
console.log({ availableModels: models.map((model) => model.name) });
