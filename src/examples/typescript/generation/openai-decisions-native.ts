// ax-example:start
// title: TypeScript Native OpenAI Decisions
// group: generation
// description: Evaluates predicate, choice, and score questions with native probabilities and refusal handling.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
import { openaiDecisions } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');
const client = openaiDecisions({ apiKey });
const decision = await client.create({
  input: 'Checkout fails for every customer. Payments cannot complete.',
  questions: [
    {
      type: 'predicate',
      name: 'urgent',
      instructions: 'Does this require immediate incident response?',
    },
    {
      type: 'choice',
      name: 'team',
      instructions: 'Which team should investigate?',
      choices: [
        { value: 'support', description: 'Product usage questions' },
        {
          value: 'engineering',
          description: 'Broken functionality or service outages',
        },
      ],
    },
    {
      type: 'score',
      name: 'severity',
      instructions: 'How severe is the customer impact?',
      levels: [
        { label: 'Minor', description: 'A minor inconvenience' },
        {
          label: 'Impaired',
          description: 'A feature is impaired but has a workaround',
        },
        {
          label: 'Blocked',
          description: 'A core task is blocked with no workaround',
        },
      ],
    },
  ],
});
const [urgent, team, severity] = decision.answers;
for (const answer of decision.answers) {
  if (answer.type === 'refusal')
    throw new Error(`Question refused: ${answer.name}`);
}
if (urgent.type === 'predicate')
  console.log({
    escalate: urgent.probability >= 0.9,
    probability: urgent.probability,
  });
if (team.type === 'choice')
  console.log({ team: team.choice, confidence: team.confidence });
if (severity.type === 'score')
  console.log({
    severity: severity.score,
    probabilities: severity.probabilities,
  });
console.log(decision.usage);
