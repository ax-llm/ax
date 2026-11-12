// ax-example:start
// title: TypeScript Native Google Gemini Decisions
// group: generation
// description: Send named yes/no, choice, and score questions directly to the Gemini Decisions API.
// provider: google-gemini-decisions
// env: GOOGLE_APIKEY, GEMINI_API_KEY, GOOGLE_API_KEY
// level: intermediate
// order: 48
// ax-example:end
import { googleGeminiDecisions } from '@ax-llm/ax';

const apiKey =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  process.env.GOOGLE_APIKEY;
if (!apiKey)
  throw new Error('Set GEMINI_API_KEY, GOOGLE_API_KEY or GOOGLE_APIKEY.');
const client = googleGeminiDecisions({ apiKey });
const result = await client.create({
  input: 'Checkout fails for every customer. Payments cannot complete.',
  questions: {
    urgent: {
      type: 'noul',
      instructions: 'Does this require immediate incident response?',
      criteria: {
        true_description: 'A core task is blocked for many customers.',
        false_description: 'An isolated request or minor inconvenience.',
      },
    },
    team: {
      type: 'choice',
      instructions: 'Which team should investigate?',
      criteria: {
        support: 'Product usage questions',
        engineering: 'Broken functionality or service outages',
      },
    },
    severity: {
      type: 'score',
      instructions: 'How severe is the customer impact?',
      criteria: [
        'Minor inconvenience',
        'Feature impaired',
        'Core task blocked',
      ],
    },
  },
});
console.log({
  escalate: result.answers.urgent.noul >= 0.9,
  team: result.answers.team.choice,
  severity: result.answers.severity.score,
  usage: result.usage,
});
