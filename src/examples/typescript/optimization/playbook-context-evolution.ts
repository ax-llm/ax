// ax-example:start
// title: TypeScript Playbook Context Evolution
// group: optimization
// description: Grows a context playbook offline with playbook().evolve, then refines it online with .update().
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 30
// ax-example:end
import { AxAIOpenAIModel, type AxMetricFn, ai, ax, playbook } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const studentAI = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0.2 },
});

// A generator we want to improve without hand-editing its prompt.
const triage = ax('ticket:string -> urgency:class "p0, p1, p2"');
triage.setDescription('Classify the support ticket urgency.');

// Labeled examples capture the nuance we want the playbook to absorb.
const train = [
  {
    ticket: 'Checkout is down for all customers in the EU region.',
    urgency: 'p0',
  },
  { ticket: 'A single user cannot change their avatar.', urgency: 'p2' },
  {
    ticket: 'Login works but is intermittently slow for many users.',
    urgency: 'p1',
  },
  { ticket: 'Production database returns 500s on every write.', urgency: 'p0' },
  { ticket: 'Typo in the footer copyright year.', urgency: 'p2' },
];

const metric: AxMetricFn = ({ prediction, example }) =>
  (prediction as { urgency?: string }).urgency ===
  (example as { urgency?: string }).urgency
    ? 1
    : 0;

// 1) Grow a playbook offline from the labeled examples (ACE runs under the hood).
const pb = playbook(triage, { studentAI, maxEpochs: 2 });
const { bestScore } = await pb.evolve(train, metric);
pb.applyTo(triage);

console.log(`offline best score: ${bestScore}`);
console.log('\nlearned playbook:\n');
console.log(pb.render());

// 2) Use the improved program.
const live = await triage.forward(studentAI, {
  ticket: 'Password reset emails are delayed ~10 minutes for some users.',
});
console.log('\nlive prediction:', live);

// 3) Keep improving online from feedback — no metric required.
await pb.update({
  example: { ticket: 'The status page itself is unreachable.' },
  prediction: { urgency: 'p2' },
  feedback: 'WRONG: if customers cannot even see status, treat it as p0.',
});
pb.applyTo(triage);

// 4) Persist the playbook and restore it into a fresh program instance.
const snapshot = pb.toJSON();
const restored = playbook(ax('ticket:string -> urgency:class "p0, p1, p2"'), {
  studentAI,
}).load(snapshot);
console.log(
  '\nrestored playbook bullets:',
  restored.getState().playbook.stats.bulletCount
);
