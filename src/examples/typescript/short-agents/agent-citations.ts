// ax-example:start
// title: TypeScript Agent — Chain-of-Evidence Citations
// group: short-agents
// description: An agent whose answer cites which evidence entries support it, validated in-pipeline — the model cannot cite evidence it never collected.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
import { AxAIOpenAIModel, agent, ai } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini },
});

const NOTES = [
  '# Platform sync notes (June 3)',
  'Decision: adopt tiered caching behind flag CACHE-TIER-11 starting July.',
  'Incident: the June 1 outage traced to connection-pool exhaustion (ticket INC-4482).',
  'Budget: the vector-store migration is capped at 40k EUR (line BUD-77).',
].join('\n');

// `citations: true` adds an optional `evidenceCitations` output. The responder
// must list the evidence ids it relied on; an id that doesn't exist in the
// curated evidence is rejected and re-prompted. Read them off the result.
const analyst = agent('notes:string, query:string -> answer:string', {
  ai: llm,
  contextFields: ['notes'],
  citations: true,
  maxTurns: 6,
});

const res = (await analyst.forward(llm, {
  notes: NOTES,
  query: 'What caused the June 1 outage and what is its ticket id?',
})) as { answer: string; evidenceCitations?: string[] };

console.log('Answer:    ', res.answer);
console.log('Cited ids: ', res.evidenceCitations ?? []);
console.log(
  '\nThe cited ids are the keys of the evidence the agent curated — the model'
);
console.log('cannot cite a source it never collected (validated in-pipeline).');
